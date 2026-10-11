import { createHash } from "node:crypto";
import { migrate } from "./schema.ts";
import type { EngineDeps, SqlDatabase } from "./ports.ts";
import { postingFactsSchema, type ExtractionInput, type PostingFacts } from "./extraction/facts.ts";
import {
  jobReading, type FactAnswer, type FeedRequirement, type JobRequirement, type KeyFact, type NeedsYouItem, type Screening,
} from "./extraction/reading.ts";
import { htmlToText } from "./extraction/text.ts";
import { detectCompany, slugFor, type CompanyDetection, type DetectOptions } from "./companies.ts";
import { isInYourLocations } from "./locations.ts";
import type { FoundPosting, SourceCategory } from "./sources/adapter.ts";
import { adapterFor, adapters, kindLabel } from "./sources/registry.ts";

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
  /**
   * The Source's own salary text, else the salary read from the posting ("Unclear" while it waits
   * for Kris). Null means none is stated, or the posting isn't read yet (see `reading`).
   */
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
  state: JobState;
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

export interface AddSourceOptions {
  /**
   * Add it only if it was never added before: a Source Kris paused or removed stays that way. Used for
   * Sources from the APPLY_KIT_SOURCES setting, which seed the watchlist once on each start.
   */
  onlyIfNew?: boolean;
}

/** What removing a Source would do to its open Jobs (Packages and Applications are never touched). */
export interface RemovalPreview {
  sourceId: string;
  name: string;
  label: string;
  /** Open (new or saved) Jobs this Source lists. */
  openJobs: number;
  /** Open Jobs only this Source covers: they close with "Source removed". */
  closing: number;
  /** Open Jobs another Source also covers: they stay open. */
  stayingOpen: number;
  /** The other Sources keeping them open, with how many each covers. */
  stayingVia: { sourceId: string; name: string; jobs: number }[];
}

/** How "Source removed" reads on a closed Job. */
export const sourceRemovedHow = "Source removed";

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

/** Paused: Kris stopped its checks; its Jobs stay as they are. */
export type SourceStatus = "not-checked" | "working" | "failing" | "paused";

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
  /**
   * Adds a Source. Adding the same Source again (same kind and key) changes nothing, except that a
   * removed or paused one comes back and is checked again (unless `onlyIfNew`).
   */
  addSource(source: NewSource, options?: AddSourceOptions): Promise<SourceInfo>;
  /** Stops checking a Source. Nothing closes: its Jobs stay as they are. */
  pauseSource(sourceId: string): Promise<SourceInfo>;
  /** Checks a paused Source again from the next Check. */
  resumeSource(sourceId: string): Promise<SourceInfo>;
  /** What removing a Source would close and what stays open through other Sources. */
  previewRemoval(sourceId: string): Promise<RemovalPreview>;
  /**
   * Removes a Source from the watchlist: it's no longer checked or listed, and its open Jobs that no
   * other Source covers close with "Source removed" (Passed & closed, reopenable). Passed Jobs,
   * Packages and Applications are untouched. Undoing the returned Decision brings the Source back.
   */
  removeSource(sourceId: string): Promise<{ sourceId: string; decision: Decision }>;
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
   * its state before. A Job Kris has decided on again since is left alone. Undoing a whole removal
   * also brings its Source back. Returns the Jobs (and Sources) restored.
   */
  undo(decisionId: string, jobIds?: string[]): Promise<{ jobIds: string[]; sourceIds: string[] }>;
  /** Closes Jobs that aren't closed yet, saying how in plain words ("No longer listed by Greenhouse"). */
  close(jobIds: string[], how: string): Promise<Decision>;
  /** Reopens closed Jobs: they go back to New. */
  reopen(jobIds: string[]): Promise<Decision>;
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
  /**
   * Finds which job system a company uses, from its name or a careers link: one request per job
   * system, through the same polite fetch as Checks. Reports progress as each system answers. Adds
   * nothing: Kris adds what was found with addSource. When nothing is found, `fallbacks` lists
   * other ways to catch its jobs, best first.
   */
  detectCompany(input: string, options?: DetectOptions): Promise<CompanyDetection>;
}

export interface ReadResult {
  read: number;
  failed: number;
  /** Left unread because the monthly AI budget would be crossed. */
  unscreened: number;
}

/** How many recent Checks sourceHealth returns per Source. */
const historyLength = 14;

/** How long one Source request may take before the Check counts as timed out. */
const checkTimeoutMs = 30_000;

/** Sent with every Source request so hosts can see who is asking. */
const userAgent = "apply-kit/0.1 (personal job search; https://github.com/krisiliev-dev/apply-kit)";

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

  // Polite polling: one request at a time per host, across every Source and Check, spaced by the
  // Source type's crawl delay (Lever asks for 1 s).
  const hosts = new Map<string, { tail: Promise<void> | null; lastStartMs: number }>();
  const wait = (ms: number) => (clock.wait ? clock.wait(ms) : new Promise<void>((r) => setTimeout(r, ms)));
  function politely(url: string, gapMs: number, send: () => Promise<Response>): Promise<Response> {
    const host = new URL(url).host;
    const h = hosts.get(host) ?? { tail: null, lastStartMs: -Infinity };
    hosts.set(host, h);
    const start = () => {
      h.lastStartMs = clock.now().getTime();
      return send();
    };
    // A free host is asked straight away (no extra tick); otherwise the request queues behind the others.
    const run = !h.tail && h.lastStartMs + gapMs <= clock.now().getTime()
      ? startNow(start)
      : (h.tail ?? Promise.resolve()).then(async () => {
          const gap = h.lastStartMs + gapMs - clock.now().getTime();
          if (gap > 0) await wait(gap);
          return start();
        });
    const tail: Promise<void> = run.then(() => undefined, () => undefined).then(() => {
      if (h.tail === tail) h.tail = null;
    });
    h.tail = tail;
    return run;
  }

  const count = (sql: string, ...params: string[]) => Number(db.prepare(sql).get(...params)?.n ?? 0);
  const countStates = (states: string[]) =>
    count(`SELECT COUNT(*) AS n FROM job WHERE state IN (${states.map(() => "?").join(",")})`, ...states);

  /**
   * The fetch every Source request goes through: polite per host (spaced by the Source type's crawl
   * delay), identified by the user agent, and timed out. `watch` sees each answer and failure.
   */
  function fetchFor(kind: string, watch: { status?(s: number): void; failed?(err: unknown): void } = {}): typeof fetch {
    const gapMs = adapters[kind]?.crawlDelayMs ?? 0;
    return async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(init?.headers);
      if (!headers.has("user-agent")) headers.set("user-agent", userAgent);
      try {
        const res = await politely(url, gapMs, () =>
          deps.fetch(input, { ...init, headers, signal: init?.signal ?? AbortSignal.timeout(checkTimeoutMs) }));
        watch.status?.(res.status);
        return res;
      } catch (err) {
        watch.failed?.(err);
        throw err;
      }
    };
  }

  async function checkOne(row: Record<string, unknown>, startedAt: string): Promise<SourceCheck> {
    const sourceId = String(row.id);
    const name = String(row.name);
    let rateLimited = false;
    let timedOut = false;
    // Adapters only throw; the engine watches their requests to tell a timeout or rate limit from other errors.
    const watched = fetchFor(String(row.kind), {
      status: (s) => { if (s === 429) rateLimited = true; },
      failed: (err) => { if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) timedOut = true; },
    });
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
    const rows = db.prepare("SELECT id, name, kind, paused_at FROM source WHERE removed_at IS NULL ORDER BY created_at, id").all();
    const history = db.prepare(
      `SELECT checked_at, outcome, in_locations, total, error FROM source_check
       WHERE source_id = ? ORDER BY checked_at DESC, id DESC LIMIT ${historyLength}`,
    );
    return rows.map((r) => describeSource(r, history.all(String(r.id)).map(toCheckRecord)));
  }

  /** A Source on the watchlist (paused or not), or throws. Removed Sources are gone as far as Kris can tell. */
  function liveSource(sourceId: string): Record<string, unknown> {
    const row = db.prepare("SELECT id, name, kind, config FROM source WHERE id = ? AND removed_at IS NULL").get(sourceId);
    if (!row) throw new Error(`No source "${sourceId}"`);
    return row;
  }

  function sourceInfo(id: string): SourceInfo {
    const row = db.prepare("SELECT id, kind, name FROM source WHERE id = ?").get(id)!;
    return { id: String(row.id), kind: String(row.kind), name: String(row.name) };
  }

  /** Other watchlist Sources (paused ones included) with a Posting in this Job. */
  function coveringSources(jobId: string, exceptSourceId: string) {
    return db.prepare(
      `SELECT DISTINCT s.id, s.name FROM posting p JOIN source s ON s.id = p.source_id
       WHERE p.job_id = ? AND s.id != ? AND s.removed_at IS NULL ORDER BY s.created_at, s.id`,
    ).all(jobId, exceptSourceId);
  }

  /** A Source's open Jobs, and those of them no other Source covers. */
  function removalImpact(sourceId: string): { open: string[]; closing: string[] } {
    const open = db.prepare(
      `SELECT DISTINCT j.id FROM job j JOIN posting p ON p.job_id = j.id
       WHERE p.source_id = ? AND j.state IN ('new', 'saved') ORDER BY j.id`,
    ).all(sourceId).map((r) => String(r.id));
    return { open, closing: open.filter((id) => coveringSources(id, sourceId).length === 0) };
  }

  function describeSource(r: Record<string, unknown>, history: CheckRecord[]): SourceHealth {
    const id = String(r.id);
    const kind = String(r.kind);
    const lastGood = db.prepare("SELECT MAX(checked_at) AS at FROM source_check WHERE source_id = ? AND outcome = 'ok'").get(id)?.at;
    const lastGoodCheckAt = lastGood == null ? null : String(lastGood);
    const latest = history[0];
    const status: SourceStatus = r.paused_at != null ? "paused" : !latest ? "not-checked" : latest.outcome === "ok" ? "working" : "failing";
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

  async function getJob(id: string): Promise<JobDetail | null> {
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
      state: String(j.state) as JobState,
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
      const sourceIds: string[] = [];
      if (!only) {
        for (const r of db.prepare("SELECT id FROM source WHERE removed_decision_id = ? AND removed_at IS NOT NULL").all(decisionId)) {
          db.prepare("UPDATE source SET removed_at = NULL, removed_decision_id = NULL WHERE id = ?").run(String(r.id));
          sourceIds.push(String(r.id));
        }
      }
      return { jobIds: restored, sourceIds };
    },

    async queryFeed(query) {
      const sources = count("SELECT COUNT(*) AS n FROM source WHERE removed_at IS NULL");
      const money = budget();
      const states = viewStates[query.view];
      const rows = db.prepare(
        `SELECT j.id, p.id AS posting_id, j.state, j.state_changed_at, j.pass_reason, j.pass_note, j.closed_how,
                p.title, p.company, p.location, p.salary, p.posted_at, p.url,
                (SELECT COUNT(*) FROM posting WHERE job_id = j.id) AS n,
                (SELECT decision_id FROM decision_job
                  WHERE job_id = j.id AND undone_at IS NULL ORDER BY rowid DESC LIMIT 1) AS decision_id
         FROM job j
         JOIN posting p ON p.id = ${representativePosting("j.id")}
         WHERE j.state IN (${states.map(() => "?").join(",")})
         ORDER BY ${query.view === "passed" ? "j.state_changed_at DESC, " : ""}p.posted_at IS NULL, p.posted_at DESC, j.id`,
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
          salary: r.salary != null ? String(r.salary) : readSalary(read?.keyFacts),
          postedAt: r.posted_at == null ? null : String(r.posted_at),
          postingCount: Number(r.n),
          url: String(r.url),
          reading: reading.state,
          requirements: read ? read.requirements.map(({ text, kind, status, needsYou }) => ({ text, kind, status, needsYou })) : [],
          needsYou: read ? read.needsYou.length : 0,
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
          };
        }),
        counts: {
          new: countStates(viewStates.new),
          saved: countStates(viewStates.saved),
          open: countStates(viewStates.open),
          passed: countStates(viewStates.passed),
          hidden: 0,
        },
        health: summarise(allSourceHealth()),
        ranking: { learnedAdjustments: 0 },
        budget: money,
      };
    },

    async addSource({ kind, config, name }, options = {}) {
      const adapter = adapterFor(kind);
      const parsed = adapter.parseConfig(config);
      const id = `${kind}:${adapter.key(parsed)}`;
      db.prepare("INSERT OR IGNORE INTO source (id, name, kind, config, created_at) VALUES (?, ?, ?, ?, ?)").run(
        id, name ?? adapter.defaultName(parsed), kind, JSON.stringify(parsed), clock.now().toISOString(),
      );
      if (!options.onlyIfNew) db.prepare("UPDATE source SET removed_at = NULL, removed_decision_id = NULL, paused_at = NULL WHERE id = ?").run(id);
      return sourceInfo(id);
    },

    async pauseSource(sourceId) {
      liveSource(sourceId);
      db.prepare("UPDATE source SET paused_at = COALESCE(paused_at, ?) WHERE id = ?").run(clock.now().toISOString(), sourceId);
      return sourceInfo(sourceId);
    },

    async resumeSource(sourceId) {
      liveSource(sourceId);
      db.prepare("UPDATE source SET paused_at = NULL WHERE id = ?").run(sourceId);
      return sourceInfo(sourceId);
    },

    async previewRemoval(sourceId) {
      const source = liveSource(sourceId);
      const { open, closing } = removalImpact(sourceId);
      const via = new Map<string, { sourceId: string; name: string; jobs: number }>();
      for (const job of open) {
        for (const other of coveringSources(job, sourceId)) {
          const entry = via.get(String(other.id)) ?? { sourceId: String(other.id), name: String(other.name), jobs: 0 };
          entry.jobs++;
          via.set(entry.sourceId, entry);
        }
      }
      return {
        sourceId, name: String(source.name), label: kindLabel(String(source.kind)),
        openJobs: open.length, closing: closing.length, stayingOpen: open.length - closing.length, stayingVia: [...via.values()],
      };
    },

    async removeSource(sourceId) {
      liveSource(sourceId);
      const decision = decide("close", removalImpact(sourceId).closing, ["new", "saved"], "closed", { closedHow: sourceRemovedHow });
      db.prepare("UPDATE source SET removed_at = ?, removed_decision_id = ? WHERE id = ?").run(clock.now().toISOString(), decision.id, sourceId);
      return { sourceId, decision };
    },

    getJob,

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
      return (await getJob(jobId))!;
    },

    async readJob(jobId) {
      const row = db.prepare(`${toReadSql} WHERE j.id = ?`).get(jobId);
      if (!row) throw new Error(`No job with id "${jobId}"`);
      if (readingOf(String(row.id), false).state !== "read") await readPosting(row);
      return (await getJob(jobId))!;
    },

    readPending() {
      pendingRun ??= readAllPending().finally(() => { pendingRun = null; });
      return pendingRun;
    },

    async checkAll(options = {}) {
      const startedAt = clock.now().toISOString();
      const rows = db.prepare(
        "SELECT id, name, kind, config FROM source WHERE removed_at IS NULL AND paused_at IS NULL ORDER BY created_at, id",
      ).all();
      options.onStart?.(rows.length);
      const sources = await Promise.all(rows.map(async (r) => {
        const result = await checkOne(r, startedAt);
        options.onSourceChecked?.(result);
        return result;
      }));
      return { startedAt, sources };
    },

    async checkSource(sourceId) {
      return checkOne(liveSource(sourceId), clock.now().toISOString());
    },

    async detectCompany(input, options) {
      const monthAgo = new Date(clock.now().getTime() - 30 * 86_400_000).toISOString();
      return detectCompany(input, {
        fetchFor: (kind) => fetchFor(kind),
        setting,
        existingSource: (id) => (db.prepare("SELECT id FROM source WHERE id = ? AND removed_at IS NULL").get(id) ? id : undefined),
        aggregatorJobs: (_company, slug) => {
          const rows = db.prepare(
            `SELECT s.id, s.name, s.kind, p.company, COUNT(DISTINCT p.job_id) AS n FROM posting p JOIN source s ON s.id = p.source_id
             WHERE p.last_seen_at >= ? AND s.removed_at IS NULL GROUP BY s.id, p.company ORDER BY s.created_at, s.id`,
          ).all(monthAgo);
          const bySource = new Map<string, { id: string; name: string; jobs: number }>();
          for (const r of rows) {
            if ((adapters[String(r.kind)]?.category ?? "ats") === "ats") continue;
            const company = slugFor(String(r.company));
            if (!slug || !(company === slug || (slug.length >= 4 && company.startsWith(slug)))) continue;
            const entry = bySource.get(String(r.id)) ?? { id: String(r.id), name: String(r.name), jobs: 0 };
            entry.jobs += Number(r.n);
            bySource.set(entry.id, entry);
          }
          return [...bySource.values()];
        },
      }, options);
    },

    async sourceHealth() {
      const sources = allSourceHealth();
      return { asOf: clock.now().toISOString(), summary: summarise(sources), sources };
    },
  };
}

function startNow(start: () => Promise<Response>): Promise<Response> {
  try {
    return start();
  } catch (err) {
    return Promise.reject(err);
  }
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

/** The salary a read gives a Feed row: the reading in use, "Unclear" while it waits for Kris, null if not stated. */
function readSalary(keyFacts: KeyFact[] | undefined): string | null {
  const fact = keyFacts?.find((f) => f.key === "salary");
  if (!fact) return null;
  if (fact.needsYou) return "Unclear";
  return fact.value === "Not stated" ? null : fact.value;
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
