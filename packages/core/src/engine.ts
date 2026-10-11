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
  /** The Source type's name as people write it ("Lever", "SmartRecruiters"). */
  typeLabel: string;
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

export interface DiscoveryEngine {
  queryFeed(query: FeedQuery): Promise<FeedResult>;
  /** Adds a Source. Adding the same Source again (same kind and key) changes nothing. */
  addSource(source: NewSource): Promise<SourceInfo>;
  /** Checks every Source now. A failing Source is reported, never thrown, and changes nothing. */
  checkAll(): Promise<CheckResult>;
  /** Checks one Source now ("Try now"). Same rules as checkAll; throws only if the Source doesn't exist. */
  checkSource(sourceId: string): Promise<SourceCheck>;
  /** Every Source with its status, latest Checks and what a failure means for the Feed. */
  sourceHealth(): Promise<HealthReport>;
}

/** How many recent Checks sourceHealth returns per Source. */
const historyLength = 14;

/** How long one Source request may take before the Check counts as timed out. */
const checkTimeoutMs = 30_000;

/** Sent with every Source request so hosts can see who is asking. */
const userAgent = "apply-kit/0.1 (personal job search; https://github.com/krisiliev-dev/apply-kit)";

const viewStates: Record<FeedView, string[]> = {
  new: ["new"],
  saved: ["saved"],
  open: ["new", "saved"],
  passed: ["passed", "closed"],
};

export function createEngine(deps: EngineDeps): DiscoveryEngine {
  const { db, clock } = deps;
  migrate(db);

  // Polite polling: one request at a time per host, across every Source and Check, spaced by the
  // Source type's crawl delay (Lever asks for 1 s).
  const hosts = new Map<string, { tail: Promise<unknown>; lastStartMs: number }>();
  const sleep = (ms: number) => (clock.sleep ? clock.sleep(ms) : new Promise<void>((r) => setTimeout(r, ms)));
  function politely(url: string, gapMs: number, send: () => Promise<Response>): Promise<Response> {
    const host = new URL(url).host;
    const h = hosts.get(host) ?? { tail: Promise.resolve(), lastStartMs: -Infinity };
    hosts.set(host, h);
    const run = h.tail.then(async () => {
      const wait = h.lastStartMs + gapMs - clock.now().getTime();
      if (wait > 0) await sleep(wait);
      h.lastStartMs = clock.now().getTime();
      return send();
    });
    h.tail = run.catch(() => undefined);
    return run;
  }

  const count = (sql: string, ...params: string[]) => Number(db.prepare(sql).get(...params)?.n ?? 0);
  const countStates = (states: string[]) =>
    count(`SELECT COUNT(*) AS n FROM job WHERE state IN (${states.map(() => "?").join(",")})`, ...states);

  async function checkOne(row: Record<string, unknown>, startedAt: string): Promise<SourceCheck> {
    const sourceId = String(row.id);
    const name = String(row.name);
    let rateLimited = false;
    let timedOut = false;
    const gapMs = adapters[String(row.kind)]?.crawlDelayMs ?? 0;
    // Adapters only throw; the engine watches their requests to tell a timeout or rate limit from other errors.
    const watched: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(init?.headers);
      if (!headers.has("user-agent")) headers.set("user-agent", userAgent);
      try {
        const res = await politely(url, gapMs, () =>
          deps.fetch(input, { ...init, headers, signal: init?.signal ?? AbortSignal.timeout(checkTimeoutMs) }));
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
      const found = await adapter.fetchPostings(config, { fetch: watched });
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
      id, name: String(r.name), kind, typeLabel: adapters[kind]?.label ?? kind[0]!.toUpperCase() + kind.slice(1),
      category: adapters[kind]?.category ?? "ats",
      status, failingSince, lastGoodCheckAt, jobsKept, history,
    };
  }

  return {
    async queryFeed(query) {
      const sources = count("SELECT COUNT(*) AS n FROM source");
      const states = viewStates[query.view];
      const rows = db.prepare(
        `SELECT j.id, p.title, p.company, p.location, p.salary, p.posted_at, p.url,
                (SELECT COUNT(*) FROM posting WHERE job_id = j.id) AS n
         FROM job j
         JOIN posting p ON p.id = (SELECT id FROM posting WHERE job_id = j.id ORDER BY first_seen_at, id LIMIT 1)
         WHERE j.state IN (${states.map(() => "?").join(",")})
         ORDER BY p.posted_at IS NULL, p.posted_at DESC, j.id`,
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

    async checkAll() {
      const startedAt = clock.now().toISOString();
      const rows = db.prepare("SELECT id, name, kind, config FROM source ORDER BY created_at, id").all();
      const sources = await Promise.all(rows.map((r) => checkOne(r, startedAt)));
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
