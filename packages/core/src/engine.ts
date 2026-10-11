import { createHash } from "node:crypto";
import { migrate } from "./schema.ts";
import type { AlertEmail, EngineDeps, SqlDatabase } from "./ports.ts";
import { postingFactsSchema, type ExtractionInput, type PostingFacts } from "./extraction/facts.ts";
import {
  jobReading, type FactAnswer, type FeedRequirement, type JobRequirement, type KeyFact, type NeedsYouItem, type Screening,
} from "./extraction/reading.ts";
import { htmlToText } from "./extraction/text.ts";
import { isInYourLocations } from "./locations.ts";
import { mailboxFix, mailboxProblemOf, type MailboxProblem } from "./mailbox.ts";
import type { FoundPosting, SourceCategory } from "./sources/adapter.ts";
import { isEmailAlertAdapter } from "./sources/adapter.ts";
import { adapterFor, adapters } from "./sources/registry.ts";
import { backfillMatchKeys, liveJobId, reconcile, refreshMatchKey, setTarget, split, targetOf } from "./merging.ts";
import { describeMergeReason, type MergeReason } from "./matching.ts";

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
  /** How many different sites (link hosts) list it: the Feed's "on N sites". */
  siteCount: number;
  /** Link to the Job's target posting (by default the company's own page). */
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

/** One Posting of a Job, as the Job page lists it. */
export interface JobPosting {
  id: string;
  source: { id: string; name: string; kind: string; label: string; category: SourceCategory };
  /** The site its link is on ("dev.bg", "job-boards.eu.greenhouse.io"). */
  site: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  isTarget: boolean;
  /** Why it was merged into this Job, in plain words; null for the Posting the Job started from. */
  mergedBecause: string | null;
}

/** One Job in full, for the Job page: every Posting merged into it, the target marked, and its reading. */
export interface JobDetail {
  id: string;
  title: string;
  company: string;
  location: string | null;
  /** Salary as the Source's structured data states it, or null. The read salary is in keyFacts. */
  salary: string | null;
  postedAt: string | null;
  /** Link to the target posting. */
  url: string;
  state: JobState;
  /** How many Postings were merged into this Job, and on how many sites. */
  postingCount: number;
  siteCount: number;
  postings: JobPosting[];
  target: {
    postingId: string;
    /** "default" until Kris picks one ("Make target"). */
    chosenBy: "default" | "you";
    /** Why this is the target, in plain words. */
    why: string;
  };
  /** The reading below is of the target posting (the one Kris applies through). */
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

/** The job mailbox that feeds every email-alert Source, as Sources shows it. */
export interface MailboxHealth {
  /** "not-read" until the first read; "error" when the latest read failed. */
  state: "not-read" | "connected" | "error";
  problem: MailboxProblem | null;
  /** The reader's own message for the latest failure. */
  error: string | null;
  /** What the user does about it, naming the settings involved. */
  fix: string | null;
  /** First failed read in the current run of failures. */
  since: string | null;
  /** The latest good read. */
  lastReadAt: string | null;
  /** The latest alert email any email Source received. */
  lastEmailAt: string | null;
}

/** Overall source health: drives the top-bar pill and the Feed's failed-source banner. */
export interface HealthSummary {
  state: HealthState;
  sources: number;
  /** The most recent Check of any Source, or null if nothing has been checked yet. */
  lastCheckAt: string | null;
  failing: FailingSource[];
  /** Email-alert Sources quiet longer than usual. Never closes jobs; the user checks the alert is still on. */
  quiet: QuietSource[];
  /**
   * The job mailbox, or null when no email-alert Source is connected. While it fails, its email
   * Sources are reported here once instead of one by one in `failing`.
   */
  mailbox: MailboxHealth | null;
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

/** "quiet": an email-alert Source whose silence is more than 3× its usual gap between emails. */
export type SourceStatus = "not-checked" | "working" | "failing" | "quiet";

/** An email-alert Source's rhythm, learned from the emails it received in the last 6 weeks. */
export interface AlertRhythm {
  /** The latest alert email from this sender, or null if none has arrived yet. */
  lastEmailAt: string | null;
  /** The usual (median) gap between emails, or null until there are at least 4 emails to learn from. */
  usualGapHours: number | null;
  /** 3× the usual gap: a silence longer than this is "quiet longer than usual". */
  warnAfterHours: number | null;
  /** When the silence passed 3× the usual gap, or null if it hasn't. */
  quietSince: string | null;
}

/** An email-alert Source that has been quiet longer than usual. */
export interface QuietSource {
  sourceId: string;
  name: string;
  lastEmailAt: string;
  usualGapHours: number;
  /** Hours since its latest email. */
  silentHours: number;
}

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
  /** Email-alert Sources only: their email rhythm. Null for every other Source. */
  alerts: AlertRhythm | null;
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
  /**
   * One Job with all its Postings and the target marked, or null if there's no such Job. A Job
   * that was merged into another answers with the Job it now lives in (check the returned id).
   */
  getJob(jobId: string): Promise<JobDetail | null>;
  /** Makes one of a Job's Postings its target posting ("Make target"); kept across later checks. */
  setTarget(jobId: string, postingId: string): Promise<JobDetail>;
  /**
   * "Not the same job? Split": separates a Posting from its Job. The Job keeps its id, state and
   * decisions with the Posting it was created from; the other side becomes its own Job (its old
   * Job restored if it had one, else New). Remembered: later checks never merge them again.
   */
  splitPosting(jobId: string, postingId: string): Promise<{ jobIds: [string, string] }>;
  /**
   * Reads every open Job's posting that hasn't been read (or whose text changed, or whose last read
   * failed), newest first, within the monthly AI budget. Never throws for a single posting.
   */
  readPending(): Promise<ReadResult>;
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

/** How many recent Checks sourceHealth returns per Source. */
const historyLength = 14;

/** How far back a mailbox read looks. Alerts older than this are left alone. */
const mailLookbackMs = 14 * 24 * 60 * 60_000;

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
  backfillMatchKeys(db);

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
    count(`SELECT COUNT(*) AS n FROM job WHERE merged_into IS NULL AND state IN (${states.map(() => "?").join(",")})`, ...states);

  /** One read of the job mailbox, shared by every email Source in a check and made only if one needs it. */
  function mailboxRead(): () => Promise<AlertEmail[]> {
    let read: Promise<AlertEmail[]> | null = null;
    return () => (read ??= readMailbox());
  }

  async function readMailbox(): Promise<AlertEmail[]> {
    const at = clock.now().toISOString();
    const record = db.prepare("INSERT INTO mailbox_read (read_at, outcome, reason, error, emails) VALUES (?, ?, ?, ?, ?)");
    try {
      const emails = await deps.mailReader.fetchSince(new Date(clock.now().getTime() - mailLookbackMs));
      record.run(at, "ok", null, null, emails.length);
      return emails;
    } catch (err) {
      record.run(at, "error", mailboxProblemOf(err), err instanceof Error ? err.message : String(err), null);
      throw err;
    }
  }

  function mailboxHealth(sources: SourceHealth[]): MailboxHealth | null {
    if (!sources.some((s) => s.category === "email")) return null;
    const latest = db.prepare("SELECT read_at, outcome, reason, error FROM mailbox_read ORDER BY id DESC LIMIT 1").get();
    const lastOk = db.prepare("SELECT MAX(read_at) AS at FROM mailbox_read WHERE outcome = 'ok'").get()?.at;
    const lastEmail = db.prepare("SELECT MAX(received_at) AS at FROM alert_email").get()?.at;
    const lastReadAt = lastOk == null ? null : String(lastOk);
    const lastEmailAt = lastEmail == null ? null : String(lastEmail);
    if (!latest || latest.outcome === "ok") {
      return { state: latest ? "connected" : "not-read", problem: null, error: null, fix: null, since: null, lastReadAt, lastEmailAt };
    }
    const problem = String(latest.reason) as MailboxProblem;
    const since = String(db.prepare("SELECT MIN(read_at) AS at FROM mailbox_read WHERE outcome != 'ok' AND read_at > ?").get(lastReadAt ?? "")!.at);
    return {
      state: "error", problem, error: latest.error == null ? null : String(latest.error), fix: mailboxFix[problem] ?? mailboxFix.error,
      since, lastReadAt, lastEmailAt,
    };
  }

  function summary(sources: SourceHealth[]): HealthSummary {
    return summarise(sources, mailboxHealth(sources), clock.now());
  }

  async function checkOne(row: Record<string, unknown>, startedAt: string, mail: () => Promise<AlertEmail[]>): Promise<SourceCheck> {
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
      let emails: { email: AlertEmail; postings: FoundPosting[] }[] = [];
      let found: FoundPosting[];
      if (isEmailAlertAdapter(adapter)) {
        emails = (await mail()).filter((e) => adapter.isFrom(config, e)).map((email) => ({ email, postings: adapter.parseEmail(config, email) }));
        found = emails.flatMap((e) => e.postings);
      } else {
        found = await adapter.fetchPostings(config, { fetch: watched, setting, mail });
      }
      const inLocations = found.filter((p) => isInYourLocations(p.location)).length;
      const newPostings = transaction(db, () => {
        for (const { email, postings } of emails) recordAlertEmail(db, sourceId, email, postings.length);
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

  /** The posting a Job is read from: its target posting (the company's own page by default). */
  function postingToRead(jobId: string): Record<string, unknown> | undefined {
    return db.prepare("SELECT id, title, company, location, description_html FROM posting WHERE id = ?").get(targetOf(db, jobId).postingId);
  }

  async function readAllPending(): Promise<ReadResult> {
    const result: ReadResult = { read: 0, failed: 0, unscreened: 0 };
    const jobIds = db.prepare(
      `SELECT j.id FROM job j JOIN posting p ON p.id = ${representativePosting("j.id")}
       WHERE j.merged_into IS NULL AND j.state IN ('new', 'saved') ORDER BY p.posted_at IS NULL, p.posted_at DESC, j.id`,
    ).all().map((r) => String(r.id));
    for (const jobId of jobIds) {
      const row = postingToRead(jobId);
      if (!row) continue;
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
        const job = db.prepare("SELECT state, state_changed_at, pass_reason, pass_note, closed_how FROM job WHERE id = ? AND merged_into IS NULL").get(jobId);
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

  // A Job's display fields come from its earliest-seen Posting.
  const jobSelect = `SELECT j.id, j.state, j.state_changed_at, j.pass_reason, j.pass_note, j.closed_how,
                p.title, p.company, p.location, p.salary, p.posted_at, p.url,
                (SELECT COUNT(*) FROM posting WHERE job_id = j.id) AS n,
                (SELECT decision_id FROM decision_job
                  WHERE job_id = j.id AND undone_at IS NULL ORDER BY rowid DESC LIMIT 1) AS decision_id
         FROM job j
         JOIN posting p ON p.id = ${representativePosting("j.id")}`;

  function toFeedJob(r: Record<string, unknown>, money = budget()): FeedJob {
    const links = linksOf(String(r.id));
    const reading = readingOf(links.targetId, money.reached);
    const read = readOf(links.targetId, reading);
    return {
      id: String(r.id),
      title: String(r.title),
      company: String(r.company),
      location: sqlText(r.location),
      salary: r.salary != null ? String(r.salary) : readSalary(read?.keyFacts),
      postedAt: sqlText(r.posted_at),
      postingCount: Number(r.n),
      siteCount: links.siteCount,
      url: links.url,
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
  }

  async function getJob(requestedId: string): Promise<JobDetail | null> {
    const jobId = liveJobId(db, requestedId);
    if (!jobId) return null;
    const row = db.prepare(`${jobSelect} WHERE j.id = ?`).get(jobId);
    if (!row) return null;
    const target = targetOf(db, jobId);
    const postings = db.prepare(
      `SELECT p.*, s.name AS source_name, s.kind FROM posting p JOIN source s ON s.id = p.source_id
       WHERE p.job_id = ? ORDER BY p.first_seen_at, p.id`,
    ).all(jobId).map((p): JobPosting => {
      const kind = String(p.kind);
      const reason = sqlText(p.merge_reason);
      return {
        id: String(p.id),
        source: { id: String(p.source_id), name: String(p.source_name), kind, label: kindLabel(kind), category: adapters[kind]?.category ?? "ats" },
        site: siteOf(String(p.url)),
        url: String(p.url),
        title: String(p.title),
        company: String(p.company),
        location: sqlText(p.location),
        salary: sqlText(p.salary),
        postedAt: sqlText(p.posted_at),
        firstSeenAt: String(p.first_seen_at),
        lastSeenAt: String(p.last_seen_at),
        isTarget: p.id === target.postingId,
        mergedBecause: reason ? describeMergeReason(JSON.parse(reason) as MergeReason) : null,
      };
    });
    const t = postings.find((p) => p.isTarget)!;
    const why = target.chosenBy === "you" ? "You chose this posting"
      : t.source.category === "ats" ? `The company's own page (${t.source.label})`
      : "First seen here: none of the postings is on the company's own page";
    const money = budget();
    const reading = readingOf(target.postingId, money.reached);
    const read = readOf(target.postingId, reading);
    return {
      id: jobId,
      title: String(row.title),
      company: String(row.company),
      location: sqlText(row.location),
      salary: sqlText(row.salary),
      postedAt: sqlText(row.posted_at),
      url: t.url,
      state: String(row.state) as JobState,
      postingCount: postings.length,
      siteCount: new Set(postings.map((p) => p.site)).size,
      postings,
      target: { ...target, why },
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

  /** The target posting's link and how many sites list the Job. */
  function linksOf(jobId: string): { siteCount: number; url: string; targetId: string } {
    const rows = db.prepare("SELECT id, url FROM posting WHERE job_id = ?").all(jobId);
    const target = targetOf(db, jobId).postingId;
    return {
      siteCount: new Set(rows.map((r) => siteOf(String(r.url)))).size,
      url: String(rows.find((r) => r.id === target)?.url ?? rows[0]?.url),
      targetId: target,
    };
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
    const alerts = adapters[kind]?.category === "email" ? alertRhythm(db, id, clock.now()) : null;
    const status: SourceStatus = !latest ? "not-checked" : latest.outcome !== "ok" ? "failing" : alerts?.quietSince ? "quiet" : "working";
    const failingSince = status !== "failing" ? null : String(db.prepare(
      "SELECT MIN(checked_at) AS at FROM source_check WHERE source_id = ? AND outcome != 'ok' AND checked_at > ?",
    ).get(id, lastGoodCheckAt ?? "")!.at);
    const jobsKept = count(
      `SELECT COUNT(DISTINCT j.id) AS n FROM job j JOIN posting p ON p.job_id = j.id
       WHERE p.source_id = ? AND j.state IN ('new', 'saved')`, id,
    );
    return {
      id, name: String(r.name), kind, label: kindLabel(kind), category: adapters[kind]?.category ?? "ats",
      status, failingSince, lastGoodCheckAt, jobsKept, history, alerts,
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

    async setTarget(jobId, postingId) {
      setTarget(db, jobId, postingId);
      return (await getJob(jobId))!;
    },

    async splitPosting(jobId, postingId) {
      return transaction(db, () => split(db, jobId, postingId, clock.now().toISOString()));
    },

    async queryFeed(query) {
      const sources = count("SELECT COUNT(*) AS n FROM source");
      const money = budget();
      const states = viewStates[query.view];
      const rows = db.prepare(
        `${jobSelect}
         WHERE j.merged_into IS NULL AND j.state IN (${states.map(() => "?").join(",")})
         ORDER BY ${query.view === "passed" ? "j.state_changed_at DESC, " : ""}p.posted_at IS NULL, p.posted_at DESC, j.id`,
      ).all(...states);
      return {
        view: query.view,
        asOf: clock.now().toISOString(),
        firstRun: sources === 0,
        jobs: rows.map((r) => toFeedJob(r, money)),
        counts: {
          new: countStates(viewStates.new),
          saved: countStates(viewStates.saved),
          open: countStates(viewStates.open),
          passed: countStates(viewStates.passed),
          hidden: 0,
        },
        health: summary(allSourceHealth()),
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

    getJob,

    async confirmFact(jobId, factKey, answer) {
      const live = liveJobId(db, jobId);
      if (!live) throw new Error(`No job with id "${jobId}"`);
      const postingId = targetOf(db, live).postingId;
      const read = readOf(postingId, readingOf(postingId));
      if (!read?.needsYou.some((n) => n.key === factKey)) throw new Error(`"${factKey}" doesn't need an answer on this job`);
      if (answer !== "extracted" && answer !== "cautious") throw new Error(`Unknown answer "${String(answer)}"`);
      db.prepare("INSERT OR REPLACE INTO fact_confirmation (posting_id, fact_key, choice, confirmed_at) VALUES (?, ?, ?, ?)").run(
        postingId, factKey, answer, clock.now().toISOString(),
      );
      return (await getJob(jobId))!;
    },

    async readJob(jobId) {
      const live = liveJobId(db, jobId);
      const row = live && postingToRead(live);
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
      const rows = db.prepare("SELECT id, name, kind, config FROM source ORDER BY created_at, id").all();
      options.onStart?.(rows.length);
      const mail = mailboxRead();
      const sources = await Promise.all(rows.map(async (r) => {
        const result = await checkOne(r, startedAt, mail);
        options.onSourceChecked?.(result);
        return result;
      }));
      return { startedAt, sources };
    },

    async checkSource(sourceId) {
      const row = db.prepare("SELECT id, name, kind, config FROM source WHERE id = ?").get(sourceId);
      if (!row) throw new Error(`No source "${sourceId}"`);
      return checkOne(row, clock.now().toISOString(), mailboxRead());
    },

    async sourceHealth() {
      const sources = allSourceHealth();
      return { asOf: clock.now().toISOString(), summary: summary(sources), sources };
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

/** The site a link is on, "www." aside ("dev.bg", "job-boards.eu.greenhouse.io"). */
function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function kindLabel(kind: string): string {
  return adapters[kind]?.label ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

function summarise(sources: SourceHealth[], mailbox: MailboxHealth | null, now: Date): HealthSummary {
  const failing: FailingSource[] = sources.flatMap((s) => {
    const latest = s.history[0];
    if (s.status !== "failing" || !latest || latest.outcome === "ok") return [];
    // A mailbox failure is shown once, on the mailbox, not once per email Source.
    if (s.category === "email" && mailbox?.state === "error") return [];
    return [{
      sourceId: s.id, name: s.name, outcome: latest.outcome, error: latest.error ?? "",
      at: latest.at, since: s.failingSince ?? latest.at, jobsKept: s.jobsKept,
    }];
  });
  const times = sources.map((s) => s.history[0]?.at).filter((t): t is string => t != null).sort();
  return {
    state: sources.length === 0 ? "no-sources" : failing.length > 0 || mailbox?.state === "error" ? "failing" : "working",
    sources: sources.length,
    lastCheckAt: times.at(-1) ?? null,
    failing,
    quiet: sources.flatMap((s) => {
      const a = s.alerts;
      if (s.status !== "quiet" || !a?.lastEmailAt || a.usualGapHours == null) return [];
      const silentHours = toHours(now.getTime() - Date.parse(a.lastEmailAt));
      return [{ sourceId: s.id, name: s.name, lastEmailAt: a.lastEmailAt, usualGapHours: a.usualGapHours, silentHours }];
    }),
    mailbox,
  };
}

function recordAlertEmail(db: SqlDatabase, sourceId: string, email: AlertEmail, postings: number): void {
  db.prepare("INSERT OR IGNORE INTO alert_email (source_id, email_id, received_at, subject, postings) VALUES (?, ?, ?, ?, ?)")
    .run(sourceId, email.id, email.receivedAt.toISOString(), email.subject, postings);
}

const hourMs = 60 * 60_000;
const toHours = (ms: number) => Math.round((ms / hourMs) * 10) / 10;

/** How far back an alert's rhythm is learned from. */
const rhythmWindowMs = 42 * 24 * hourMs;
/** Emails closer together than this count as one (a duplicate sent twice, two alerts in one batch). */
const sameBatchMs = hourMs;
/** Gaps needed before a rhythm is trusted: 4 emails. */
const minGaps = 3;
/** "Quiet longer than usual" is a silence of more than this many usual gaps (DESIGN.md). */
const quietFactor = 3;

/**
 * An email-alert Source's rhythm: the median gap between its emails over the last 6 weeks, and
 * whether the silence since the latest one is more than 3× that.
 */
function alertRhythm(db: SqlDatabase, sourceId: string, now: Date): AlertRhythm {
  const last = db.prepare("SELECT MAX(received_at) AS at FROM alert_email WHERE source_id = ?").get(sourceId)?.at;
  const lastEmailAt = last == null ? null : String(last);
  const times = db.prepare("SELECT received_at FROM alert_email WHERE source_id = ? AND received_at >= ? ORDER BY received_at")
    .all(sourceId, new Date(now.getTime() - rhythmWindowMs).toISOString())
    .map((r) => Date.parse(String(r.received_at)));
  const gaps: number[] = [];
  let prev: number | null = null;
  for (const t of times) {
    if (prev !== null && t - prev < sameBatchMs) continue;
    if (prev !== null) gaps.push(t - prev);
    prev = t;
  }
  if (!lastEmailAt || gaps.length < minGaps) return { lastEmailAt, usualGapHours: null, warnAfterHours: null, quietSince: null };
  const usualGap = median(gaps);
  const quietAt = Date.parse(lastEmailAt) + quietFactor * usualGap;
  return {
    lastEmailAt,
    usualGapHours: toHours(usualGap),
    warnAfterHours: toHours(quietFactor * usualGap),
    quietSince: now.getTime() > quietAt ? new Date(quietAt).toISOString() : null,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
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

/** SQL for the Posting a Job's display fields come from: the first one seen (ordering only; reads use the target). */
const representativePosting = (jobIdSql: string) =>
  `(SELECT id FROM posting WHERE job_id = ${jobIdSql} ORDER BY first_seen_at, id LIMIT 1)`;

const postingText = (html: unknown) => (html == null ? "" : htmlToText(String(html)));
const hashText = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Upserts one Posting by its stable identity (source id + the Source's own id). A Posting seen for
 * the first time gets its own Job, then merges with any Job it's the same as (see merging.ts).
 * Returns true if new.
 */
function storePosting(db: SqlDatabase, sourceId: string, p: FoundPosting, now: string): boolean {
  const id = `${sourceId}:${p.externalId}`;
  const existing = db.prepare("SELECT id FROM posting WHERE id = ?").get(id);
  if (existing) {
    db.prepare(
      `UPDATE posting SET url = ?, title = ?, company = ?, location = ?, salary = ?, posted_at = ?,
              description_html = ?, last_seen_at = ? WHERE id = ?`,
    ).run(p.url, p.title, p.company, p.location, p.salary, p.postedAt, p.descriptionHtml, now, id);
    refreshMatchKey(db, id, p);
    reconcile(db, id);
    return false;
  }
  const jobId = `job:${id}`;
  db.prepare("INSERT INTO job (id, title, company, state, created_at) VALUES (?, ?, ?, 'new', ?)").run(jobId, p.title, p.company, now);
  db.prepare(
    `INSERT INTO posting (id, source_id, external_id, job_id, url, title, company, location, salary, posted_at,
                          description_html, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sourceId, p.externalId, jobId, p.url, p.title, p.company, p.location, p.salary, p.postedAt, p.descriptionHtml, now, now);
  refreshMatchKey(db, id, p);
  reconcile(db, id);
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
