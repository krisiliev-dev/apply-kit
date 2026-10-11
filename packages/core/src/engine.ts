import { migrate } from "./schema.ts";
import type { EngineDeps, SqlDatabase } from "./ports.ts";
import type { FoundPosting } from "./sources/adapter.ts";
import { adapterFor } from "./sources/registry.ts";

export type FeedView = "new" | "saved" | "open" | "passed";

export interface FeedQuery {
  view: FeedView;
}

/** One row of the Feed. Fit, requirements and the why-line arrive with their tickets. */
export interface FeedJob {
  id: string;
  title: string;
  company: string;
  location: string | null;
  /** Null means the posting doesn't state one; the UI shows "Not stated". */
  salary: string | null;
  /** When the Source says the job was first published (ISO 8601), if known. */
  postedAt: string | null;
  /** How many Postings were merged into this Job. */
  postingCount: number;
  /** Link to the job's posting. */
  url: string;
  state: JobState;
  /** Set on passed Jobs: when, the reason Kris chose (null when he gave none), and the Decision to undo. */
  passed?: { at: string; reason: PassReason | null; note: string | null; decisionId: string };
  /** Set on closed Jobs: when, how it closed in plain words, and the Decision to undo. */
  closed?: { at: string; how: string; decisionId: string };
}

/** The pass reasons Kris can choose from. None is ever chosen for him. */
export const passReasons = ["skills-gap", "salary", "location", "company", "other"] as const;
export type PassReason = (typeof passReasons)[number];

export interface PassInput {
  reason?: PassReason | null;
  note?: string | null;
}

export type HealthState = "no-sources" | "working";

export interface FeedResult {
  view: FeedView;
  /** When this answer was computed, from the injected clock (ISO 8601). */
  asOf: string;
  /** True until the first source is connected: the UI shows the first-run state. */
  firstRun: boolean;
  jobs: FeedJob[];
  counts: { new: number; saved: number; open: number; passed: number; hidden: number };
  health: { state: HealthState; sources: number };
  ranking: { learnedAdjustments: number };
}

export interface NewSource {
  /** A Source type the engine knows, e.g. "greenhouse". */
  kind: string;
  /** The adapter's config object or its shorthand string (Greenhouse: the board token). */
  config: unknown;
  name?: string;
}

export interface SourceInfo {
  id: string;
  kind: string;
  name: string;
}

export type SourceCheck =
  | { sourceId: string; name: string; ok: true; found: number; newPostings: number }
  | { sourceId: string; name: string; ok: false; error: string };

export interface CheckResult {
  /** When the check started, from the injected clock (ISO 8601). */
  startedAt: string;
  sources: SourceCheck[];
}

/** A save, pass, close or reopen. Its id undoes it. */
export interface Decision {
  id: string;
  kind: "save" | "pass" | "close" | "reopen";
  /** The Jobs it changed. Jobs it didn't apply to (say, saving a closed job) are left out. */
  jobIds: string[];
}

export interface DiscoveryEngine {
  queryFeed(query: FeedQuery): Promise<FeedResult>;
  /** Adds a Source. Adding the same Source again (same kind and key) changes nothing. */
  addSource(source: NewSource): Promise<SourceInfo>;
  /** Checks every Source now. A failing Source is reported, never thrown, and changes nothing. */
  checkAll(): Promise<CheckResult>;
  /** Saves open Jobs (new → saved). */
  save(jobIds: string[]): Promise<Decision>;
  /** Passes open Jobs, with the reason and note Kris gave (both optional, never defaulted). */
  pass(jobIds: string[], input?: PassInput): Promise<Decision>;
  /**
   * Undoes a Decision, for all its Jobs or only the given ones, at any time: each Job goes back to
   * its state before. A Job Kris has decided on again since is left alone. Returns the Jobs restored.
   */
  undo(decisionId: string, jobIds?: string[]): Promise<{ jobIds: string[] }>;
  /** Closes Jobs that aren't closed yet, saying how in plain words ("No longer listed by Greenhouse"). */
  close(jobIds: string[], how: string): Promise<Decision>;
  /** Reopens closed Jobs: they go back to New. */
  reopen(jobIds: string[]): Promise<Decision>;
}

export type JobState = "new" | "saved" | "passed" | "closed";

interface StateFields {
  passReason?: string | null;
  passNote?: string | null;
  closedHow?: string | null;
}

const sqlText = (v: unknown): string | null => (v == null ? null : String(v));

const viewStates: Record<FeedView, JobState[]> = {
  new: ["new"],
  saved: ["saved"],
  open: ["new", "saved"],
  passed: ["passed", "closed"],
};

export function createEngine(deps: EngineDeps): DiscoveryEngine {
  const { db, clock } = deps;
  migrate(db);

  const count = (sql: string, ...params: string[]) => Number(db.prepare(sql).get(...params)?.n ?? 0);
  const countStates = (states: string[]) =>
    count(`SELECT COUNT(*) AS n FROM job WHERE state IN (${states.map(() => "?").join(",")})`, ...states);

  async function checkOne(row: Record<string, unknown>, startedAt: string): Promise<SourceCheck> {
    const sourceId = String(row.id);
    const name = String(row.name);
    try {
      const adapter = adapterFor(String(row.kind));
      const config = adapter.parseConfig(JSON.parse(String(row.config)));
      const found = await adapter.fetchPostings(config, { fetch: deps.fetch });
      const newPostings = transaction(db, () => found.filter((p) => storePosting(db, sourceId, p, startedAt)).length);
      return { sourceId, name, ok: true, found: found.length, newPostings };
    } catch (err) {
      return { sourceId, name, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Moves each Job currently in one of `from` to `to`, remembering its previous state. */
  function decide(kind: Decision["kind"], jobIds: string[], from: JobState[], to: JobState, fields: StateFields = {}): Decision {
    const id = `decision:${crypto.randomUUID()}`;
    const now = clock.now().toISOString();
    const changed = transaction(db, () => {
      db.prepare("INSERT INTO decision (id, kind, created_at) VALUES (?, ?, ?)").run(id, kind, now);
      const out: string[] = [];
      for (const jobId of new Set(jobIds)) {
        const job = db.prepare("SELECT state, state_changed_at, pass_reason, pass_note, closed_how FROM job WHERE id = ?").get(jobId);
        if (!job || !from.includes(String(job.state) as JobState)) continue;
        db.prepare(
          `INSERT INTO decision_job (decision_id, job_id, prev_state, prev_changed_at, prev_pass_reason, prev_pass_note, prev_closed_how)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, jobId, String(job.state), sqlText(job.state_changed_at), sqlText(job.pass_reason), sqlText(job.pass_note), sqlText(job.closed_how));
        setState(jobId, to, now, fields);
        out.push(jobId);
      }
      return out;
    });
    return { id, kind, jobIds: changed };
  }

  function setState(jobId: string, state: string, changedAt: string | null, f: StateFields) {
    db.prepare("UPDATE job SET state = ?, state_changed_at = ?, pass_reason = ?, pass_note = ?, closed_how = ? WHERE id = ?").run(
      state, changedAt, f.passReason ?? null, f.passNote ?? null, f.closedHow ?? null, jobId,
    );
  }

  return {
    async save(jobIds) {
      return decide("save", jobIds, ["new"], "saved");
    },

    async pass(jobIds, input = {}) {
      const reason = input.reason ?? null;
      if (reason !== null && !passReasons.includes(reason)) throw new Error(`Unknown pass reason "${String(reason)}"`);
      const note = input.note?.trim() || null;
      return decide("pass", jobIds, ["new", "saved"], "passed", { passReason: reason, passNote: note });
    },

    async close(jobIds, how) {
      return decide("close", jobIds, ["new", "saved", "passed"], "closed", { closedHow: how });
    },

    async reopen(jobIds) {
      return decide("reopen", jobIds, ["closed"], "new");
    },

    async undo(decisionId, only) {
      const now = clock.now().toISOString();
      const restored = transaction(db, () => {
        const rows = db.prepare(
          `SELECT dj.rowid AS rid, dj.* FROM decision_job dj
           WHERE dj.decision_id = ? AND dj.undone_at IS NULL
             AND dj.rowid = (SELECT MAX(rowid) FROM decision_job WHERE job_id = dj.job_id AND undone_at IS NULL)
           ORDER BY dj.rowid`,
        ).all(decisionId);
        const out: string[] = [];
        for (const r of rows) {
          const jobId = String(r.job_id);
          if (only && !only.includes(jobId)) continue;
          setState(jobId, String(r.prev_state), sqlText(r.prev_changed_at), {
            passReason: sqlText(r.prev_pass_reason), passNote: sqlText(r.prev_pass_note), closedHow: sqlText(r.prev_closed_how),
          });
          db.prepare("UPDATE decision_job SET undone_at = ? WHERE rowid = ?").run(now, Number(r.rid));
          out.push(jobId);
        }
        return out;
      });
      return { jobIds: restored };
    },

    async queryFeed(query) {
      const sources = count("SELECT COUNT(*) AS n FROM source");
      const states = viewStates[query.view];
      const rows = db.prepare(
        `SELECT j.id, j.state, j.state_changed_at, j.pass_reason, j.pass_note, j.closed_how,
                p.title, p.company, p.location, p.salary, p.posted_at, p.url,
                (SELECT COUNT(*) FROM posting WHERE job_id = j.id) AS n,
                (SELECT decision_id FROM decision_job
                  WHERE job_id = j.id AND undone_at IS NULL ORDER BY rowid DESC LIMIT 1) AS decision_id
         FROM job j
         JOIN posting p ON p.id = (SELECT id FROM posting WHERE job_id = j.id ORDER BY first_seen_at, id LIMIT 1)
         WHERE j.state IN (${states.map(() => "?").join(",")})
         ORDER BY ${query.view === "passed" ? "j.state_changed_at DESC, " : ""}p.posted_at IS NULL, p.posted_at DESC, j.id`,
      ).all(...states);
      return {
        view: query.view,
        asOf: clock.now().toISOString(),
        firstRun: sources === 0,
        jobs: rows.map((r) => ({
          id: String(r.id),
          title: String(r.title),
          company: String(r.company),
          location: r.location == null ? null : String(r.location),
          salary: r.salary == null ? null : String(r.salary),
          postedAt: r.posted_at == null ? null : String(r.posted_at),
          postingCount: Number(r.n),
          url: String(r.url),
          state: String(r.state) as JobState,
          ...(r.state === "passed" && {
            passed: {
              at: String(r.state_changed_at),
              reason: (sqlText(r.pass_reason) as PassReason | null),
              note: sqlText(r.pass_note),
              decisionId: String(r.decision_id),
            },
          }),
          ...(r.state === "closed" && {
            closed: { at: String(r.state_changed_at), how: String(r.closed_how), decisionId: String(r.decision_id) },
          }),
        })),
        counts: {
          new: countStates(viewStates.new),
          saved: countStates(viewStates.saved),
          open: countStates(viewStates.open),
          passed: countStates(viewStates.passed),
          hidden: 0,
        },
        health: { state: sources === 0 ? "no-sources" : "working", sources },
        ranking: { learnedAdjustments: 0 },
      };
    },

    async addSource({ kind, config, name }) {
      const adapter = adapterFor(kind);
      const parsed = adapter.parseConfig(config);
      const id = `${kind}:${adapter.key(parsed)}`;
      db.prepare("INSERT OR IGNORE INTO source (id, name, kind, config, created_at) VALUES (?, ?, ?, ?, ?)").run(
        id, name ?? adapter.defaultName(parsed), kind, JSON.stringify(parsed), clock.now().toISOString(),
      );
      const row = db.prepare("SELECT id, kind, name FROM source WHERE id = ?").get(id)!;
      return { id: String(row.id), kind: String(row.kind), name: String(row.name) };
    },

    async checkAll() {
      const startedAt = clock.now().toISOString();
      const rows = db.prepare("SELECT id, name, kind, config FROM source ORDER BY created_at, id").all();
      const sources = await Promise.all(rows.map((r) => checkOne(r, startedAt)));
      return { startedAt, sources };
    },
  };
}

/**
 * Upserts one Posting by its stable identity (source id + the Source's own id). A Posting seen for
 * the first time gets its own Job; merging Postings into shared Jobs comes later. Returns true if new.
 */
function storePosting(db: SqlDatabase, sourceId: string, p: FoundPosting, now: string): boolean {
  const id = `${sourceId}:${p.externalId}`;
  const existing = db.prepare("SELECT id FROM posting WHERE id = ?").get(id);
  if (existing) {
    db.prepare(
      `UPDATE posting SET url = ?, title = ?, company = ?, location = ?, salary = ?, posted_at = ?,
              description_html = ?, last_seen_at = ? WHERE id = ?`,
    ).run(p.url, p.title, p.company, p.location, p.salary, p.postedAt, p.descriptionHtml, now, id);
    return false;
  }
  const jobId = `job:${id}`;
  db.prepare("INSERT INTO job (id, title, company, state, created_at) VALUES (?, ?, ?, 'new', ?)").run(jobId, p.title, p.company, now);
  db.prepare(
    `INSERT INTO posting (id, source_id, external_id, job_id, url, title, company, location, salary, posted_at,
                          description_html, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sourceId, p.externalId, jobId, p.url, p.title, p.company, p.location, p.salary, p.postedAt, p.descriptionHtml, now, now);
  return true;
}

function transaction<T>(db: SqlDatabase, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
