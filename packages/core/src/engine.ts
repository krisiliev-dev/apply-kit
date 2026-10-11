import { migrate } from "./schema.ts";
import type { EngineDeps, SqlDatabase } from "./ports.ts";
import { isInYourLocations } from "./locations.ts";
import type { FoundPosting, SourceCategory } from "./sources/adapter.ts";
import { adapterFor, adapters } from "./sources/registry.ts";

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

export type HealthState = "no-sources" | "working" | "failing";

/** A Source whose latest Check failed, and what that means for the Feed. */
export interface FailingSource {
  sourceId: string;
  name: string;
  outcome: CheckFailure;
  error: string;
  /** The latest failed Check. */
  at: string;
  /** The first failed Check in this run of failures. */
  since: string;
  /** Open Jobs kept exactly as they were. */
  jobsKept: number;
}

/** Overall source health: drives the top-bar pill and the Feed's failed-source banner. */
export interface HealthSummary {
  state: HealthState;
  sources: number;
  /** The most recent Check of any Source, or null if nothing has been checked yet. */
  lastCheckAt: string | null;
  failing: FailingSource[];
}

export interface FeedResult {
  view: FeedView;
  /** When this answer was computed, from the injected clock (ISO 8601). */
  asOf: string;
  /** True until the first source is connected: the UI shows the first-run state. */
  firstRun: boolean;
  jobs: FeedJob[];
  counts: { new: number; saved: number; open: number; passed: number; hidden: number };
  health: HealthSummary;
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

/** Why a Check failed: the Source errored, didn't answer in time, or asked us to slow down. */
export type CheckFailure = "error" | "timeout" | "rate-limited";

export type SourceCheck =
  | { sourceId: string; name: string; ok: true; found: number; newPostings: number }
  | { sourceId: string; name: string; ok: false; outcome: CheckFailure; error: string };

/** One recorded Check of one Source. Counts are null when the Check failed. */
export interface CheckRecord {
  /** When the Check ran (ISO 8601). */
  at: string;
  outcome: "ok" | CheckFailure;
  /** Postings the Source listed in Kris's locations (Sofia, or remote within Europe). */
  inLocations: number | null;
  /** Every Posting the Source listed. */
  total: number | null;
  error: string | null;
}

export type SourceStatus = "not-checked" | "working" | "failing";

export interface SourceHealth {
  id: string;
  name: string;
  kind: string;
  /** The Source type's display name ("Greenhouse", "dev.bg"). */
  label: string;
  category: SourceCategory;
  status: SourceStatus;
  /** First failed Check in the current run of failures; null unless failing. */
  failingSince: string | null;
  lastGoodCheckAt: string | null;
  /** Open Jobs this Source found. A failure keeps every one of them exactly as it was. */
  jobsKept: number;
  /** Recent Checks, newest first. */
  history: CheckRecord[];
}

export interface HealthReport {
  asOf: string;
  summary: HealthSummary;
  sources: SourceHealth[];
}

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

export interface CheckOptions {
  /** Called when the check starts, with how many Sources it will check. */
  onStart?: (total: number) => void;
  /** Called once per Source the moment its check finishes; its jobs are already in the Feed. */
  onSourceChecked?: (check: SourceCheck) => void;
}

export interface DiscoveryEngine {
  queryFeed(query: FeedQuery): Promise<FeedResult>;
  /** Adds a Source. Adding the same Source again (same kind and key) changes nothing. */
  addSource(source: NewSource): Promise<SourceInfo>;
  /**
   * Checks every Source now. A failing Source is reported, never thrown, and changes nothing.
   * Each Source's results are stored as soon as it finishes, so the Feed fills while slower ones run.
   */
  checkAll(options?: CheckOptions): Promise<CheckResult>;
  /** Checks one Source now ("Try now"). Same rules as checkAll; throws only if the Source doesn't exist. */
  checkSource(sourceId: string): Promise<SourceCheck>;
  /** Every Source with its status, latest Checks and what a failure means for the Feed. */
  sourceHealth(): Promise<HealthReport>;
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

/** How many recent Checks sourceHealth returns per Source. */
const historyLength = 14;

/** How long one Source request may take before the Check counts as timed out. */
const checkTimeoutMs = 30_000;

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

  const setting = (name: string) => deps.settings?.get(name)?.trim() || undefined;
  const count = (sql: string, ...params: string[]) => Number(db.prepare(sql).get(...params)?.n ?? 0);
  const countStates = (states: string[]) =>
    count(`SELECT COUNT(*) AS n FROM job WHERE state IN (${states.map(() => "?").join(",")})`, ...states);

  async function checkOne(row: Record<string, unknown>, startedAt: string): Promise<SourceCheck> {
    const sourceId = String(row.id);
    const name = String(row.name);
    let rateLimited = false;
    let timedOut = false;
    // Adapters only throw; the engine watches their requests to tell a timeout or rate limit from other errors.
    const watched: typeof fetch = async (input, init) => {
      try {
        const res = await deps.fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(checkTimeoutMs) });
        if (res.status === 429) rateLimited = true;
        return res;
      } catch (err) {
        if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) timedOut = true;
        throw err;
      }
    };
    try {
      const adapter = adapterFor(String(row.kind));
      const config = adapter.parseConfig(JSON.parse(String(row.config)));
      const found = await adapter.fetchPostings(config, { fetch: watched, setting });
      const inLocations = found.filter((p) => isInYourLocations(p.location)).length;
      const newPostings = transaction(db, () => {
        const fresh = found.filter((p) => storePosting(db, sourceId, p, startedAt)).length;
        recordCheck(db, sourceId, { at: startedAt, outcome: "ok", inLocations, total: found.length, error: null });
        return fresh;
      });
      return { sourceId, name, ok: true, found: found.length, newPostings };
    } catch (err) {
      const outcome: CheckFailure = timedOut ? "timeout" : rateLimited ? "rate-limited" : "error";
      const error = err instanceof Error ? err.message : String(err);
      recordCheck(db, sourceId, { at: startedAt, outcome, inLocations: null, total: null, error });
      return { sourceId, name, ok: false, outcome, error };
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

  function allSourceHealth(): SourceHealth[] {
    const rows = db.prepare("SELECT id, name, kind FROM source ORDER BY created_at, id").all();
    const history = db.prepare(
      `SELECT checked_at, outcome, in_locations, total, error FROM source_check
       WHERE source_id = ? ORDER BY checked_at DESC, id DESC LIMIT ${historyLength}`,
    );
    return rows.map((r) => describeSource(r, history.all(String(r.id)).map(toCheckRecord)));
  }

  function describeSource(r: Record<string, unknown>, history: CheckRecord[]): SourceHealth {
    const id = String(r.id);
    const kind = String(r.kind);
    const lastGood = db.prepare("SELECT MAX(checked_at) AS at FROM source_check WHERE source_id = ? AND outcome = 'ok'").get(id)?.at;
    const lastGoodCheckAt = lastGood == null ? null : String(lastGood);
    const latest = history[0];
    const status: SourceStatus = !latest ? "not-checked" : latest.outcome === "ok" ? "working" : "failing";
    const failingSince = status !== "failing" ? null : String(db.prepare(
      "SELECT MIN(checked_at) AS at FROM source_check WHERE source_id = ? AND outcome != 'ok' AND checked_at > ?",
    ).get(id, lastGoodCheckAt ?? "")!.at);
    const jobsKept = count(
      `SELECT COUNT(DISTINCT j.id) AS n FROM job j JOIN posting p ON p.job_id = j.id
       WHERE p.source_id = ? AND j.state IN ('new', 'saved')`, id,
    );
    return {
      id, name: String(r.name), kind, label: kindLabel(kind), category: adapters[kind]?.category ?? "ats",
      status, failingSince, lastGoodCheckAt, jobsKept, history,
    };
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
        health: summarise(allSourceHealth()),
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

    async checkAll(options = {}) {
      const startedAt = clock.now().toISOString();
      const rows = db.prepare("SELECT id, name, kind, config FROM source ORDER BY created_at, id").all();
      options.onStart?.(rows.length);
      const sources = await Promise.all(rows.map(async (r) => {
        const result = await checkOne(r, startedAt);
        options.onSourceChecked?.(result);
        return result;
      }));
      return { startedAt, sources };
    },

    async checkSource(sourceId) {
      const row = db.prepare("SELECT id, name, kind, config FROM source WHERE id = ?").get(sourceId);
      if (!row) throw new Error(`No source "${sourceId}"`);
      return checkOne(row, clock.now().toISOString());
    },

    async sourceHealth() {
      const sources = allSourceHealth();
      return { asOf: clock.now().toISOString(), summary: summarise(sources), sources };
    },
  };
}

function kindLabel(kind: string): string {
  return adapters[kind]?.label ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

function summarise(sources: SourceHealth[]): HealthSummary {
  const failing: FailingSource[] = sources.flatMap((s) => {
    const latest = s.history[0];
    if (s.status !== "failing" || !latest || latest.outcome === "ok") return [];
    return [{
      sourceId: s.id, name: s.name, outcome: latest.outcome, error: latest.error ?? "",
      at: latest.at, since: s.failingSince ?? latest.at, jobsKept: s.jobsKept,
    }];
  });
  const times = sources.map((s) => s.history[0]?.at).filter((t): t is string => t != null).sort();
  return {
    state: sources.length === 0 ? "no-sources" : failing.length > 0 ? "failing" : "working",
    sources: sources.length,
    lastCheckAt: times.at(-1) ?? null,
    failing,
  };
}

function recordCheck(db: SqlDatabase, sourceId: string, c: CheckRecord): void {
  db.prepare("INSERT INTO source_check (source_id, checked_at, outcome, in_locations, total, error) VALUES (?, ?, ?, ?, ?, ?)")
    .run(sourceId, c.at, c.outcome, c.inLocations, c.total, c.error);
}

function toCheckRecord(r: Record<string, unknown>): CheckRecord {
  return {
    at: String(r.checked_at),
    outcome: String(r.outcome) as CheckRecord["outcome"],
    inLocations: r.in_locations == null ? null : Number(r.in_locations),
    total: r.total == null ? null : Number(r.total),
    error: r.error == null ? null : String(r.error),
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
