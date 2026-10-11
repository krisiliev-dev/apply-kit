import { createHash } from "node:crypto";
import { migrate } from "./schema.ts";
import type { EngineDeps, SqlDatabase } from "./ports.ts";
import { postingFactsSchema, type ExtractionInput, type PostingFacts } from "./extraction/facts.ts";
import {
  jobReading, type FactAnswer, type FeedRequirement, type JobRequirement, type KeyFact, type NeedsYouItem, type Screening,
} from "./extraction/reading.ts";
import { htmlToText } from "./extraction/text.ts";
import type { FoundPosting } from "./sources/adapter.ts";
import { adapterFor } from "./sources/registry.ts";

export type FeedView = "new" | "saved" | "open" | "passed";

export interface FeedQuery {
  view: FeedView;
}

/**
 * Whether a Job's posting has been read by the extractor:
 * - unread: not read yet (it will be at the next read);
 * - reading: being read right now;
 * - read: requirements and facts are available;
 * - failed: the last read failed (retried at the next read);
 * - unscreened: not read because this month's AI budget is used up. Never hidden because of it.
 */
export type ReadingState = "unread" | "reading" | "read" | "failed" | "unscreened";

/** One row of the Feed. Fit and the why-line arrive with their tickets. */
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
  reading: ReadingState;
  /** Every requirement read from the posting (empty until it is read). */
  requirements: FeedRequirement[];
  /** How many low-confidence facts wait for Kris ("N facts need you"). */
  needsYou: number;
}

/** One Job in full, for the Job page. */
export interface JobDetail {
  id: string;
  title: string;
  company: string;
  location: string | null;
  /** Salary as the Source's structured data states it, or null. The read salary is in keyFacts. */
  salary: string | null;
  postedAt: string | null;
  url: string;
  state: string;
  postings: { id: string; source: string; url: string; firstSeenAt: string }[];
  reading: { state: ReadingState; error: string | null };
  /** The posting as plain text, one line per paragraph or list item; fact sources point at its lines. */
  postingText: string;
  requirements: JobRequirement[];
  keyFacts: KeyFact[];
  /** Low-confidence facts for Kris to confirm; the cautious reading is used until he does. */
  needsYou: NeedsYouItem[];
  /** The reading dealbreakers and Fit use, or null until the posting is read. */
  screening: Screening | null;
  /** The Fit check (Fit, closest angle, gaps) arrives with Fit; null until then. */
  fit: null;
  /** This month's AI budget, so an unscreened Job can say why. */
  budget: BudgetInfo;
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
  budget: BudgetInfo;
}

/** This month's AI spending against the cap. Once reached, unread Postings show as unscreened. */
export interface BudgetInfo {
  /** Calendar month the spending counts towards (UTC), e.g. "2026-10". */
  month: string;
  capUsd: number;
  spentUsd: number;
  reached: boolean;
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

export interface DiscoveryEngine {
  queryFeed(query: FeedQuery): Promise<FeedResult>;
  /** Adds a Source. Adding the same Source again (same kind and key) changes nothing. */
  addSource(source: NewSource): Promise<SourceInfo>;
  /** Checks every Source now. A failing Source is reported, never thrown, and changes nothing. */
  checkAll(): Promise<CheckResult>;
  /**
   * Reads every open Job's posting that hasn't been read (or whose text changed, or whose last read
   * failed), newest first, within the monthly AI budget. Never throws for a single posting.
   */
  readPending(): Promise<ReadResult>;
  /** One Job in full, or null if there is no such Job. */
  getJob(id: string): Promise<JobDetail | null>;
  /**
   * Kris's answer to one Needs-you item on a Job: keep the model's reading ("extracted") or the
   * cautious one. Applies to this Job only; the posting isn't changed. Throws if the fact isn't waiting.
   */
  confirmFact(jobId: string, factKey: string, answer: FactAnswer): Promise<JobDetail>;
  /**
   * Reads one Job's posting now (the Job page asks when it opens an unread Job), within the budget.
   * Resolves with the Job once the read has finished, failed or been refused by the cap.
   */
  readJob(jobId: string): Promise<JobDetail>;
}

export interface ReadResult {
  read: number;
  failed: number;
  /** Left unread because the monthly AI budget would be crossed. */
  unscreened: number;
}

const viewStates: Record<FeedView, string[]> = {
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

  /** Postings being read right now, so a second read waits for the first instead of starting. */
  const inFlight = new Map<string, Promise<keyof ReadResult>>();
  let pendingRun: Promise<ReadResult> | null = null;

  const month = () => clock.now().toISOString().slice(0, 7);
  const spentThisMonth = () =>
    Number(db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_spend WHERE month = ?").get(month())?.s ?? 0);
  const cap = () => Math.max(0, deps.aiMonthlyCapUsd ?? 0);
  /** The month in which a read was last refused because it would have crossed the cap. */
  let refusedInMonth: string | null = null;
  const budget = (): BudgetInfo => {
    const spentUsd = Math.round(spentThisMonth() * 1e6) / 1e6;
    const capUsd = cap();
    return { month: month(), capUsd, spentUsd, reached: capUsd <= 0 || spentUsd >= capUsd || refusedInMonth === month() };
  };

  function readingOf(postingId: string, budgetReached = budget().reached): { state: ReadingState; facts: PostingFacts | null; error: string | null; text: string } {
    const p = db.prepare("SELECT description_html FROM posting WHERE id = ?").get(postingId);
    const text = postingText(p?.description_html);
    if (inFlight.has(postingId)) return { state: "reading", facts: null, error: null, text };
    const e = db.prepare("SELECT status, text_hash, facts, error FROM extraction WHERE posting_id = ?").get(postingId);
    const current = e && e.text_hash === hashText(text);
    if (current && e.status === "read") return { state: "read", facts: JSON.parse(String(e.facts)) as PostingFacts, error: null, text };
    if (current && e.status === "failed") return { state: "failed", facts: null, error: String(e.error), text };
    return { state: budgetReached ? "unscreened" : "unread", facts: null, error: null, text };
  }

  const answersFor = (postingId: string): Record<string, FactAnswer> =>
    Object.fromEntries(
      db.prepare("SELECT fact_key, choice FROM fact_confirmation WHERE posting_id = ?").all(postingId)
        .map((r) => [String(r.fact_key), String(r.choice) as FactAnswer]),
    );

  /** The full reading of a posting (requirements, facts, Needs-you, screening), or null until it is read. */
  function readOf(postingId: string, reading: ReturnType<typeof readingOf>) {
    return reading.facts ? jobReading(reading.facts, reading.text, answersFor(postingId)) : null;
  }

  const toReadSql = `SELECT j.id AS job_id, p.id, p.title, p.company, p.location, p.description_html
       FROM job j JOIN posting p ON p.id = ${representativePosting("j.id")}`;

  async function readAllPending(): Promise<ReadResult> {
    const result: ReadResult = { read: 0, failed: 0, unscreened: 0 };
    const rows = db.prepare(
      `${toReadSql} WHERE j.state IN ('new', 'saved') ORDER BY p.posted_at IS NULL, p.posted_at DESC, j.id`,
    ).all();
    for (const row of rows) {
      const state = readingOf(String(row.id), false).state;
      if (state === "read" || state === "reading") continue;
      const outcome = await readPosting(row);
      result[outcome]++;
    }
    return result;
  }

  function readPosting(row: Record<string, unknown>): Promise<keyof ReadResult> {
    const postingId = String(row.id);
    const running = inFlight.get(postingId);
    if (running) return running;
    const run = readPostingNow(row).finally(() => inFlight.delete(postingId));
    inFlight.set(postingId, run);
    return run;
  }

  async function readPostingNow(row: Record<string, unknown>): Promise<keyof ReadResult> {
    const postingId = String(row.id);
    const text = postingText(row.description_html);
    const hash = hashText(text);
    const now = () => clock.now().toISOString();
    const store = (status: "read" | "failed", facts: PostingFacts | null, model: string | null, error: string | null) => {
      // Answers belong to one reading of one text: a changed posting is asked about afresh.
      db.prepare("DELETE FROM fact_confirmation WHERE posting_id = ?").run(postingId);
      db.prepare(
        `INSERT INTO extraction (posting_id, text_hash, status, facts, model, error, attempts, read_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT (posting_id) DO UPDATE SET text_hash = excluded.text_hash, status = excluded.status,
           facts = excluded.facts, model = excluded.model, error = excluded.error,
           attempts = extraction.attempts + 1, read_at = excluded.read_at`,
      ).run(postingId, hash, status, facts ? JSON.stringify(facts) : null, model, error, now());
    };
    if (text === "") {
      store("failed", null, null, "The posting has no text to read");
      return "failed";
    }
    const input: ExtractionInput = {
      title: String(row.title),
      company: String(row.company),
      location: row.location == null ? null : String(row.location),
      text: text.slice(0, MAX_TEXT_CHARS),
    };
    const estimate = deps.extractor.estimateCostUsd(input);
    if (spentThisMonth() + estimate > cap()) {
      refusedInMonth = month();
      return "unscreened";
    }

    try {
      const out = await deps.extractor.extract(input);
      recordSpend(postingId, Number.isFinite(out.costUsd) && out.costUsd >= 0 ? out.costUsd : estimate);
      const parsed = postingFactsSchema.safeParse(out.facts);
      if (!parsed.success) {
        store("failed", null, out.model, "The model's answer didn't have the expected shape");
        return "failed";
      }
      store("read", parsed.data, out.model, null);
      return "read";
    } catch (err) {
      const billed = (err as { costUsd?: unknown } | null)?.costUsd;
      if (typeof billed === "number" && billed > 0) recordSpend(postingId, billed);
      store("failed", null, null, err instanceof Error ? err.message : String(err));
      return "failed";
    }
  }

  function recordSpend(postingId: string, costUsd: number) {
    db.prepare("INSERT INTO ai_spend (at, month, task, posting_id, cost_usd) VALUES (?, ?, 'extraction', ?, ?)").run(
      clock.now().toISOString(), month(), postingId, costUsd,
    );
  }

  return {
    async queryFeed(query) {
      const sources = count("SELECT COUNT(*) AS n FROM source");
      const money = budget();
      const states = viewStates[query.view];
      const rows = db.prepare(
        `SELECT j.id, p.id AS posting_id, p.title, p.company, p.location, p.salary, p.posted_at, p.url,
                (SELECT COUNT(*) FROM posting WHERE job_id = j.id) AS n
         FROM job j
         JOIN posting p ON p.id = ${representativePosting("j.id")}
         WHERE j.state IN (${states.map(() => "?").join(",")})
         ORDER BY p.posted_at IS NULL, p.posted_at DESC, j.id`,
      ).all(...states);
      return {
        view: query.view,
        asOf: clock.now().toISOString(),
        firstRun: sources === 0,
        jobs: rows.map((r) => {
          const reading = readingOf(String(r.posting_id), money.reached);
          const read = readOf(String(r.posting_id), reading);
          return {
          id: String(r.id),
          title: String(r.title),
          company: String(r.company),
          location: r.location == null ? null : String(r.location),
          salary: r.salary == null ? null : String(r.salary),
          postedAt: r.posted_at == null ? null : String(r.posted_at),
          postingCount: Number(r.n),
          url: String(r.url),
          reading: reading.state,
          requirements: read ? read.requirements.map(({ text, kind, status, needsYou }) => ({ text, kind, status, needsYou })) : [],
          needsYou: read ? read.needsYou.length : 0,
          };
        }),
        counts: {
          new: countStates(viewStates.new),
          saved: countStates(viewStates.saved),
          open: countStates(viewStates.open),
          passed: countStates(viewStates.passed),
          hidden: 0,
        },
        health: { state: sources === 0 ? "no-sources" : "working", sources },
        ranking: { learnedAdjustments: 0 },
        budget: money,
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

    async getJob(id) {
      const j = db.prepare(
        `SELECT j.id, j.state, p.id AS posting_id, p.title, p.company, p.location, p.salary, p.posted_at, p.url
         FROM job j JOIN posting p ON p.id = ${representativePosting("j.id")} WHERE j.id = ?`,
      ).get(id);
      if (!j) return null;
      const postings = db.prepare(
        `SELECT p.id, s.name, p.url, p.first_seen_at FROM posting p JOIN source s ON s.id = p.source_id
         WHERE p.job_id = ? ORDER BY p.first_seen_at, p.id`,
      ).all(id);
      const money = budget();
      const reading = readingOf(String(j.posting_id), money.reached);
      const read = readOf(String(j.posting_id), reading);
      return {
        id: String(j.id),
        title: String(j.title),
        company: String(j.company),
        location: j.location == null ? null : String(j.location),
        salary: j.salary == null ? null : String(j.salary),
        postedAt: j.posted_at == null ? null : String(j.posted_at),
        url: String(j.url),
        state: String(j.state),
        postings: postings.map((p) => ({ id: String(p.id), source: String(p.name), url: String(p.url), firstSeenAt: String(p.first_seen_at) })),
        reading: { state: reading.state, error: reading.error },
        postingText: reading.text,
        requirements: read?.requirements ?? [],
        keyFacts: read?.keyFacts ?? [],
        needsYou: read?.needsYou ?? [],
        screening: read?.screening ?? null,
        fit: null,
        budget: money,
      };
    },

    async confirmFact(jobId, factKey, answer) {
      const posting = db.prepare(`SELECT ${representativePosting("?")} AS id`).get(jobId)?.id;
      if (posting == null) throw new Error(`No job with id "${jobId}"`);
      const postingId = String(posting);
      const read = readOf(postingId, readingOf(postingId));
      if (!read?.needsYou.some((n) => n.key === factKey)) throw new Error(`"${factKey}" doesn't need an answer on this job`);
      if (answer !== "extracted" && answer !== "cautious") throw new Error(`Unknown answer "${String(answer)}"`);
      db.prepare("INSERT OR REPLACE INTO fact_confirmation (posting_id, fact_key, choice, confirmed_at) VALUES (?, ?, ?, ?)").run(
        postingId, factKey, answer, clock.now().toISOString(),
      );
      return (await this.getJob(jobId))!;
    },

    async readJob(jobId) {
      const row = db.prepare(`${toReadSql} WHERE j.id = ?`).get(jobId);
      if (!row) throw new Error(`No job with id "${jobId}"`);
      if (readingOf(String(row.id), false).state !== "read") await readPosting(row);
      return (await this.getJob(jobId))!;
    },

    readPending() {
      pendingRun ??= readAllPending().finally(() => { pendingRun = null; });
      return pendingRun;
    },

    async checkAll() {
      const startedAt = clock.now().toISOString();
      const rows = db.prepare("SELECT id, name, kind, config FROM source ORDER BY created_at, id").all();
      const sources = await Promise.all(rows.map((r) => checkOne(r, startedAt)));
      return { startedAt, sources };
    },
  };
}

/** Longest posting text sent to the extractor; longer texts are cut (bounds the cost of one read). */
const MAX_TEXT_CHARS = 24_000;

/** SQL for the Posting that stands for a Job (the first one seen) until merging picks a Target posting. */
const representativePosting = (jobIdSql: string) =>
  `(SELECT id FROM posting WHERE job_id = ${jobIdSql} ORDER BY first_seen_at, id LIMIT 1)`;

const postingText = (html: unknown) => (html == null ? "" : htmlToText(String(html)));
const hashText = (text: string) => createHash("sha256").update(text).digest("hex");

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
