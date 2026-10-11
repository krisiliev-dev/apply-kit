import { createHash } from "node:crypto";
import { migrate } from "./schema.ts";
import type { AlertEmail, EngineDeps, SqlDatabase } from "./ports.ts";
import { postingFactsSchema, type ExtractionInput, type PostingFacts } from "./extraction/facts.ts";
import {
  jobReading, type FactAnswer, type FeedRequirement, type JobRequirement, type KeyFact, type NeedsYouItem, type Screening,
} from "./extraction/reading.ts";
import { htmlToText } from "./extraction/text.ts";
import { computeFit, type Fit } from "./fit/fit.ts";
import { detectCompany, slugFor, type CompanyDetection, type DetectOptions } from "./companies.ts";
import { isInYourLocations } from "./locations.ts";
import { mailboxFix, mailboxProblemOf, type MailboxProblem } from "./mailbox.ts";
import { defaultSearchSettings, parseSearchSettings, type SearchSettings } from "./search-settings.ts";
import { dealbreakersOf, monthlyEur, type DealbreakerRule, type HiddenReason } from "./dealbreakers.ts";
import type { FoundPosting, SourceCategory } from "./sources/adapter.ts";
import { isEmailAlertAdapter } from "./sources/adapter.ts";
import { adapterFor, adapters, kindLabel } from "./sources/registry.ts";
import { devbgPageListings } from "./sources/devbg.ts";
import { backfillMatchKeys, liveJobId, reconcile, refreshMatchKey, setTarget, split, targetOf, targetPostingSql } from "./merging.ts";
import { describeMergeReason, type MergeReason } from "./matching.ts";
import {
  answersSearch, coverageHistory, isReadableResultsPage, loadCoverageCheck, matchListing, parseListings, storeCoverageCheck,
  totalsOf, unreadableResultsPage, whereFound, whyMissing,
  type CompanySource, type CoverageHistory, type CoverageInput, type CoverageResult, type CoverageResultListing,
} from "./coverage.ts";
import { jobLinkFrom, linkKey, protectedSite, robotsAllows } from "./capture/links.ts";
import { readJobPage } from "./capture/page.ts";
import { escapeHtml } from "./sources/shared.ts";

/**
 * New, Saved, All open, Passed & closed, and the hidden pile: New Jobs kept out of the main Feed by
 * a dealbreaker, each with its reasons. Saved, passed and closed Jobs are never hidden.
 */
export type FeedView = "new" | "saved" | "open" | "passed" | "hidden";

export interface FeedQuery {
  view: FeedView;
  /**
   * The Relocation filter. Off (the default): relocation Jobs (Switzerland, Spain) are left out of
   * the main list and only counted. On: they follow the main list as a separate, lower-priority group.
   */
  relocation?: boolean;
  /** "fit" (the default): best Fit first. "newest": most recently posted first. Passed & closed is always latest decision first. */
  sort?: FeedSort;
}

export type FeedSort = "fit" | "newest";

/**
 * Whether a Job's posting has been read by the extractor:
 * - unread: not read yet (it will be at the next read);
 * - reading: being read right now;
 * - read: requirements and facts are available;
 * - failed: the last read failed (retried at the next read);
 * - unscreened: not read because this month's AI budget is used up. Never hidden because of it.
 */
export type ReadingState = "unread" | "reading" | "read" | "failed" | "unscreened";

/** One row of the Feed. */
export interface FeedJob {
  id: string;
  title: string;
  /** English title of a posting in another language, once read; null otherwise. */
  titleTranslation: string | null;
  /** ISO 639-1 code of the posting's language ("en", "bg"), or null until it is read. */
  language: string | null;
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
  /** Fit with its reasons and the why-line. Always present: before a read it is provisional, from the title and location. */
  fit: Fit;
  /**
   * Kris's dealbreakers this Job breaks, each with its reason in plain words. Empty until the
   * posting is read (an unread or unscreened Job is never hidden).
   */
  dealbreakers: HiddenReason[];
  /** True when it is in the hidden pile: a New Job with a dealbreaker that Kris hasn't chosen to show. */
  hidden: boolean;
  /** True when Kris chose "Show this job" despite its dealbreakers. */
  shownByYou: boolean;
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
  /** English title of a posting in another language, once read; null otherwise. */
  titleTranslation: string | null;
  /** ISO 639-1 code of the posting's language ("en", "bg"), or null until it is read. */
  language: string | null;
  /**
   * The language a package for this Job starts in: Bulgarian for a Bulgarian posting, English
   * otherwise. Switchable per package.
   */
  packageLanguage: "bg" | "en";
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
  /** The Fit check: Fit with its reasons, closest angle and gaps. Provisional until read and confirmed. */
  fit: Fit;
  /** This month's AI budget, so an unscreened Job can say why. */
  budget: BudgetInfo;
  /** The dealbreaker check: the rules this Job breaks (empty when none apply or it isn't read yet). */
  dealbreakers: HiddenReason[];
  /** In the hidden pile (see FeedJob.hidden). */
  hidden: boolean;
  /** Kris chose "Show this job" despite its dealbreakers. */
  shownByYou: boolean;
}

/** A rule Kris changed with "Not a dealbreaker for me", kept so it can be listed and undone. */
export interface RuleChange {
  id: string;
  rule: DealbreakerRule;
  /** What changed, in plain words: "German removed from the languages you don't speak". */
  text: string;
  /** The Job it was changed from, and the reason that Job was hidden. */
  job: { id: string; title: string; company: string };
  reason: string;
  at: string;
  /** When it was undone, or null. */
  undoneAt: string | null;
}

/** Why the list is empty although Jobs exist in this view: which filter holds them back. */
export interface FilteredToNothing {
  /** Relocation Jobs left out because the Relocation filter is off. */
  relocation: number;
  /** Jobs in the hidden pile, per rule (a Job breaking two rules counts under each). */
  hidden: { total: number; byRule: { rule: DealbreakerRule; jobs: number }[] };
  /** The explanation in plain words, naming each filter responsible. */
  text: string;
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
  /** True until the first source is connected or the first job added (a pasted link): the UI shows the first-run state. */
  firstRun: boolean;
  jobs: FeedJob[];
  /**
   * Jobs per view. New, Saved and All open leave relocation Jobs out; `relocation` counts the ones
   * in this view (0 for Passed & closed), whether or not the Relocation filter is on.
   */
  counts: { new: number; saved: number; open: number; passed: number; hidden: number; relocation: number };
  /**
   * Set when this view shows no Jobs but some are held back by a filter (Relocation off, or the
   * hidden pile): which filters, and how many each holds back. Null otherwise.
   */
  filteredToNothing: FilteredToNothing | null;
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

/** Paused: Kris stopped its checks; its Jobs stay as they are. "quiet": an email-alert Source whose silence is more than 3× its usual gap between emails. */
export type SourceStatus = "not-checked" | "working" | "failing" | "quiet" | "paused";

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
  /** "unhide": "Show this job" on a hidden Job; undoing it hides the Job again. */
  kind: "save" | "pass" | "close" | "reopen" | "unhide";
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
  /**
   * Finds which job system a company uses, from its name or a careers link: one request per job
   * system, through the same polite fetch as Checks. Reports progress as each system answers. Adds
   * nothing: Kris adds what was found with addSource. When nothing is found, `fallbacks` lists
   * other ways to catch its jobs, best first.
   */
  detectCompany(input: string, options?: DetectOptions): Promise<CompanyDetection>;
  /**
   * Records a coverage check: a manual search Kris ran (site, words, location, how many results he
   * saw, optionally the listings) compared with the Feed. Each listing is found (in the Feed, or kept
   * out of the main list with the reason) or missing, with the likely reason and fixes. Kept as history.
   */
  recordCoverageCheck(input: CoverageInput): Promise<CoverageResult>;
  /** Every coverage check, newest first, with missing jobs that have arrived since counted as fixed; and whether one is due. */
  coverageHistory(): Promise<CoverageHistory>;
  /** One coverage check as it was recorded (missing listings that have arrived since point at their Job), or null. */
  getCoverageCheck(id: string): Promise<CoverageResult | null>;
  /** Kris's search settings, which Fit and dealbreakers are measured against. */
  getSearchSettings(): Promise<SearchSettings>;
  /** Saves Kris's search settings (the settings form). Throws with a plain message when invalid. */
  saveSearchSettings(settings: unknown): Promise<SearchSettings>;
  /**
   * "Show this job": brings hidden Jobs back to New and changes nothing else (the rule stays).
   * Jobs that aren't hidden are left out of the Decision. Undoing it hides them again.
   */
  unhide(jobIds: string[]): Promise<Decision>;
  /**
   * "Not a dealbreaker for me" on one of a Job's hidden reasons (its key): changes the rule behind it
   * so it no longer hides this Job or future ones like it. A language is removed from the languages
   * Kris doesn't speak, the years limit is raised to what the Job asks, the salary minimum is lowered
   * to the Job's salary, and the location rule stops hiding. Returns the change and the new settings.
   */
  notADealbreaker(jobId: string, reasonKey: string): Promise<{ change: RuleChange; settings: SearchSettings }>;
  /** Every rule changed with "Not a dealbreaker for me", newest first. */
  ruleChanges(): Promise<RuleChange[]>;
  /** Puts a changed rule back as it was before that change. */
  undoRuleChange(changeId: string): Promise<{ change: RuleChange; settings: SearchSettings }>;
  /**
   * "Paste a job link": adds the job at a link to the Feed like any other Posting (merged with a Job
   * already there, ranked, read later within the budget). A link already in the Feed answers with its
   * Job and fetches nothing. The page is fetched once, politely, only where the site allows apps;
   * protected or unreadable pages answer "unreadable" with the link kept, and Kris can then pass the
   * posting's text himself (`pasted`), which is never fetched.
   */
  addJobLink(link: string, pasted?: PastedPosting): Promise<AddLinkResult>;
}

/** What Kris can paste along with a link, when the page can't be read (or he'd rather paste it). */
export interface PastedPosting {
  /** The posting's text as copied from the page. */
  text: string;
  title: string;
  /** The company, when he gives one. */
  company?: string | null;
  location?: string | null;
}

/** Why a pasted link couldn't be read. In every case the link is kept and Kris can paste the text. */
export type LinkProblem =
  /** A site that forbids apps reading it, or blocks them (LinkedIn, jobs.bg, big-tech careers). Never fetched. */
  | "protected"
  /** The site's robots.txt asks apps not to read this page. */
  | "robots"
  /** The site answered with bot protection (a challenge page or a refusal). Not retried. */
  | "blocked"
  | "not-found"
  | "timeout"
  | "error"
  /** The page was read but doesn't describe one job (a careers index, a page without the posting). */
  | "no-posting";

export type AddLinkResult =
  /** A new Job, read from the page (JSON-LD, or the page itself) or from the text Kris pasted. */
  | { outcome: "added"; jobId: string; via: "json-ld" | "page" | "text" }
  /** The link is already in the Feed: nothing was fetched; open this Job. */
  | { outcome: "existing"; jobId: string }
  /** The page describes a Job already in the Feed from another Source: the link joined it. */
  | { outcome: "merged"; jobId: string }
  /** The text isn't a web link. */
  | { outcome: "invalid"; message: string }
  | {
      outcome: "unreadable";
      /** The link as it will be kept (tracking parameters dropped). */
      link: string;
      problem: LinkProblem;
      /** What happened and what to do, in plain words. */
      message: string;
      /** The page's title, when one was read, to start the pasted job from. */
      pageTitle: string | null;
      /** For a protected site that sends job alerts: the email Source that covers it ("linkedin"). */
      alertSender: string | null;
    };

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

/**
 * SQL condition for Sources on the watchlist: every Source but the ones Kris adds jobs through himself
 * (pasted links), which are never checked and have no health to show.
 */
const onWatchlist = `kind NOT IN (${Object.entries(adapters).filter(([, a]) => a.category === "capture").map(([k]) => `'${k}'`).join(", ")})`;

const viewStates: Record<FeedView, JobState[]> = {
  new: ["new"],
  saved: ["saved"],
  open: ["new", "saved"],
  passed: ["passed", "closed"],
  hidden: ["new"],
};

export function createEngine(deps: EngineDeps): DiscoveryEngine {
  const { db, clock } = deps;
  migrate(db);
  backfillMatchKeys(db);

  const setting = (name: string) => deps.settings?.get(name)?.trim() || undefined;
  /** Kris's search settings: as he saved them, else the ones the engine was given, else the defaults. */
  const searchSettings = (): SearchSettings => {
    const stored = db.prepare("SELECT value FROM search_settings WHERE id = 1").get();
    return stored ? (JSON.parse(String(stored.value)) as SearchSettings) : (deps.searchSettings ?? defaultSearchSettings);
  };
  function storeSettings(settings: SearchSettings): SearchSettings {
    db.prepare(
      `INSERT INTO search_settings (id, value, updated_at) VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(JSON.stringify(settings), clock.now().toISOString());
    return settings;
  }

  /** The dealbreakers a read Job breaks. An unread, failed or unscreened Job breaks none: it is never hidden. */
  function dealbreakersFor(read: ReturnType<typeof readOf>, facts: PostingFacts | null, fit: Fit): HiddenReason[] {
    if (!read || !facts) return [];
    const levels = Object.fromEntries(facts.languages.map((l) => [l.language, l.level]));
    return dealbreakersOf(read.screening, fit.place, searchSettings(), levels);
  }

  const shownByYou = (jobId: string) => db.prepare("SELECT 1 AS y FROM job_unhidden WHERE job_id = ?").get(jobId) != null;
  const isHidden = (state: string, dealbreakers: HiddenReason[], shown: boolean) => state === "new" && dealbreakers.length > 0 && !shown;

  /** Fit for one Job from what is known about it now. Learned adjustments (#15) plug in here. */
  function fitOf(job: { title: string; location: string | null; postedAt: string | null }, read: ReturnType<typeof readOf>, facts: PostingFacts | null): Fit {
    return computeFit({
      title: job.title,
      titleTranslation: facts?.titleTranslation ?? null,
      location: job.location,
      postedAt: job.postedAt,
      read: read != null,
      requirements: read?.requirements ?? [],
      screening: read?.screening ?? null,
      needsYou: read?.needsYou.length ?? 0,
      settings: searchSettings(),
      now: clock.now(),
      adjustments: [],
    });
  }

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

  async function checkOne(row: Record<string, unknown>, startedAt: string, mail: () => Promise<AlertEmail[]>): Promise<SourceCheck> {
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
      `SELECT j.id FROM job j JOIN posting p ON p.id = ${targetPostingSql("j.id")}
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
        if (kind === "unhide") {
          db.prepare("INSERT OR REPLACE INTO job_unhidden (job_id, decision_id, unhidden_at) VALUES (?, ?, ?)").run(jobId, id, now);
        }
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

  // A Job's display fields come from its target posting (the company's own page by default).
  const jobSelect = `SELECT j.id, j.state, j.state_changed_at, j.pass_reason, j.pass_note, j.closed_how,
                p.title, p.company, p.location, p.salary, p.posted_at, p.url,
                (SELECT COUNT(*) FROM posting WHERE job_id = j.id) AS n,
                (SELECT decision_id FROM decision_job
                  WHERE job_id = j.id AND undone_at IS NULL ORDER BY rowid DESC LIMIT 1) AS decision_id
         FROM job j
         JOIN posting p ON p.id = ${targetPostingSql("j.id")}`;

  function toFeedJob(r: Record<string, unknown>, money = budget()): FeedJob {
    const links = linksOf(String(r.id));
    const reading = readingOf(links.targetId, money.reached);
    const read = readOf(links.targetId, reading);
    const base = { title: String(r.title), location: sqlText(r.location), postedAt: sqlText(r.posted_at) };
    const fit = fitOf(base, read, reading.facts);
    const dealbreakers = dealbreakersFor(read, reading.facts, fit);
    const shown = shownByYou(String(r.id));
    return {
      id: String(r.id),
      title: base.title,
      titleTranslation: reading.facts?.titleTranslation ?? null,
      language: reading.facts?.language ?? null,
      company: String(r.company),
      location: base.location,
      salary: r.salary != null ? String(r.salary) : readSalary(read?.keyFacts),
      postedAt: base.postedAt,
      postingCount: Number(r.n),
      siteCount: links.siteCount,
      url: links.url,
      reading: reading.state,
      requirements: read ? read.requirements.map(({ text, kind, status, needsYou }) => ({ text, kind, status, needsYou })) : [],
      needsYou: read ? read.needsYou.length : 0,
      fit,
      dealbreakers,
      hidden: isHidden(String(r.state), dealbreakers, shown),
      shownByYou: shown,
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
    const base = { title: String(row.title), location: sqlText(row.location), postedAt: sqlText(row.posted_at) };
    const language = reading.facts?.language ?? null;
    const fit = fitOf(base, read, reading.facts);
    const dealbreakers = dealbreakersFor(read, reading.facts, fit);
    const shown = shownByYou(jobId);
    return {
      id: jobId,
      title: base.title,
      titleTranslation: reading.facts?.titleTranslation ?? null,
      language,
      packageLanguage: language === "bg" ? "bg" : "en",
      company: String(row.company),
      location: base.location,
      salary: sqlText(row.salary),
      postedAt: base.postedAt,
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
      fit,
      budget: money,
      dealbreakers,
      hidden: isHidden(String(row.state), dealbreakers, shown),
      shownByYou: shown,
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
    const rows = db.prepare(`SELECT id, name, kind, paused_at FROM source WHERE removed_at IS NULL AND ${onWatchlist} ORDER BY created_at, id`).all();
    const history = db.prepare(
      `SELECT checked_at, outcome, in_locations, total, error FROM source_check
       WHERE source_id = ? ORDER BY checked_at DESC, id DESC LIMIT ${historyLength}`,
    );
    return rows.map((r) => describeSource(r, history.all(String(r.id)).map(toCheckRecord)));
  }

  /** A Source on the watchlist (paused or not), or throws. Removed Sources are gone as far as Kris can tell. */
  function liveSource(sourceId: string): Record<string, unknown> {
    const row = db.prepare(`SELECT id, name, kind, config FROM source WHERE id = ? AND removed_at IS NULL AND ${onWatchlist}`).get(sourceId);
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
    const alerts = adapters[kind]?.category === "email" ? alertRhythm(db, id, clock.now()) : null;
    const status: SourceStatus = r.paused_at != null ? "paused" : !latest ? "not-checked" : latest.outcome !== "ok" ? "failing" : alerts?.quietSince ? "quiet" : "working";
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

  const liveJob = (jobId: string) => liveJobId(db, jobId) ?? null;

  /** Every company's own job system (ATS or public jobs API), watched or removed, for coverage reasons. */
  function companySources(): CompanySource[] {
    const own = (kind: string) => ["ats", "api"].includes(adapters[kind]?.category ?? "ats");
    const config = (id: string) => JSON.parse(String(db.prepare("SELECT config FROM source WHERE id = ?").get(id)?.config ?? "{}")) as unknown;
    const watched = allSourceHealth().filter((s) => own(s.kind)).map((s): CompanySource => ({
      id: s.id, name: s.name, label: s.label, kind: s.kind, config: config(s.id),
      status: s.status, failingSince: s.failingSince, lastGoodCheckAt: s.lastGoodCheckAt,
    }));
    const removed = db.prepare("SELECT id, name, kind, config FROM source WHERE removed_at IS NOT NULL ORDER BY removed_at DESC").all()
      .filter((r) => own(String(r.kind)))
      .map((r): CompanySource => ({
        id: String(r.id), name: String(r.name), label: kindLabel(String(r.kind)), kind: String(r.kind), config: JSON.parse(String(r.config)) as unknown,
        status: "removed", failingSince: null, lastGoodCheckAt: null,
      }));
    return [...watched, ...removed];
  }

  function ruleChange(id: string): RuleChange {
    const r = db.prepare(
      `SELECT c.*, p.title, p.company FROM rule_change c JOIN job j ON j.id = c.job_id
       JOIN posting p ON p.id = ${targetPostingSql("j.id")} WHERE c.id = ?`,
    ).get(id)!;
    return {
      id, rule: String(r.rule) as DealbreakerRule, text: String(r.change_text),
      job: { id: String(r.job_id), title: String(r.title), company: String(r.company) },
      reason: String(r.reason_text), at: String(r.created_at), undoneAt: sqlText(r.undone_at),
    };
  }

  /** The Source pasted links belong to, created the first time Kris pastes one. */
  function pastedLinksSource(): string {
    const adapter = adapterFor("capture");
    const config = adapter.parseConfig("link");
    const id = `capture:${adapter.key(config)}`;
    db.prepare("INSERT OR IGNORE INTO source (id, name, kind, config, created_at) VALUES (?, ?, 'capture', ?, ?)").run(
      id, adapter.defaultName(config), JSON.stringify(config), clock.now().toISOString(),
    );
    return id;
  }

  /** The live Job holding a Posting at this link (any state), or undefined. */
  function jobWithLink(link: string): string | undefined {
    const key = linkKey(link);
    for (const r of db.prepare("SELECT job_id, url FROM posting ORDER BY first_seen_at, id").all()) {
      if (linkKey(String(r.url)) === key) return liveJobId(db, String(r.job_id));
    }
    return undefined;
  }

  /** Stores a Posting found at a pasted link; it merges with a Job already in the Feed like any other. */
  function storePasted(found: Omit<FoundPosting, "externalId">, via: "json-ld" | "page" | "text"): AddLinkResult {
    const sourceId = pastedLinksSource();
    const externalId = createHash("sha256").update(linkKey(found.url)).digest("hex").slice(0, 16);
    const now = clock.now().toISOString();
    transaction(db, () => storePosting(db, sourceId, { ...found, externalId }, now));
    const own = `job:${sourceId}:${externalId}`;
    const jobId = liveJobId(db, own) ?? own;
    const postings = count("SELECT COUNT(*) AS n FROM posting WHERE job_id = ?", jobId);
    return postings > 1 ? { outcome: "merged", jobId } : { outcome: "added", jobId, via };
  }

  async function addJobLink(text: string, pasted?: PastedPosting): Promise<AddLinkResult> {
    const link = jobLinkFrom(text);
    if (!link) return { outcome: "invalid", message: "That isn't a web link. Paste the job's address, starting with https://" };
    const existing = jobWithLink(link.href);
    if (existing) return { outcome: "existing", jobId: existing };

    if (pasted) {
      const title = pasted.title.trim();
      const body = pasted.text.trim();
      if (!title || !body) throw new Error("A pasted job needs its title and text");
      return storePasted({
        url: link.href, title, company: pasted.company?.trim() || "Company not stated", location: pasted.location?.trim() || null,
        salary: null, postedAt: null, descriptionHtml: textToHtml(body),
      }, "text");
    }

    const page = await fetchJobPage(link);
    if ("problem" in page) return { outcome: "unreadable", link: link.href, alertSender: null, pageTitle: null, ...page };
    const { posting, via, pageTitle } = readJobPage(page.html, page.url);
    if (!posting || !via) {
      return {
        outcome: "unreadable", link: link.href, problem: "no-posting", pageTitle, alertSender: null,
        message: "This page doesn't look like one job posting. Check it's the job's own page, or paste the job's text.",
      };
    }
    // The page may name its own link for the job: if that is in the Feed, it's the same job.
    const known = jobWithLink(posting.url);
    if (known) return { outcome: "existing", jobId: known };
    return storePasted({
      url: link.href, title: posting.title, company: posting.company ?? siteOf(link.href), location: posting.location,
      salary: posting.salary, postedAt: posting.postedAt, descriptionHtml: posting.descriptionHtml,
    }, via);
  }

  /** One polite GET of a pasted job page, or why it couldn't (or mustn't) be read. */
  async function fetchJobPage(link: URL): Promise<{ html: string; url: string } | { problem: LinkProblem; message: string; alertSender?: string | null }> {
    const site = protectedSite(link);
    if (site) {
      return {
        problem: "protected", alertSender: site.alertSender,
        message: `${site.name} doesn't allow apps to read its pages, so apply-kit won't open this link. Paste the job's text${site.alertSender ? `, or let its job alert emails bring it in` : ""}.`,
      };
    }
    let timedOut = false;
    const get = fetchFor("capture", { failed: (err) => { if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) timedOut = true; } });
    const host = link.hostname.replace(/^www\./, "");
    const robots = await get(`${link.origin}/robots.txt`).then((r) => (r.ok ? r.text() : ""), () => "");
    if (!robotsAllows(robots, `${link.pathname}${link.search}`, "apply-kit")) {
      return { problem: "robots", message: `${host} asks apps not to read this page (its robots.txt). Paste the job's text instead.` };
    }
    let res: Response;
    try {
      res = await get(link.href, { headers: { accept: "text/html,application/xhtml+xml" } });
    } catch {
      return timedOut
        ? { problem: "timeout", message: `${host} didn't answer in time. Try again later, or paste the job's text.` }
        : { problem: "error", message: `Couldn't reach ${host}. Check the link, or paste the job's text.` };
    }
    const html = await res.text().catch(() => "");
    if (looksBlocked(res, html)) {
      return { problem: "blocked", message: `${host} blocks apps from reading its pages. Paste the job's text instead.` };
    }
    if (res.status === 404 || res.status === 410) {
      return { problem: "not-found", message: `${host} says this page doesn't exist (${res.status}). The job may have closed, or the link may be cut short.` };
    }
    if (!res.ok) return { problem: "error", message: `${host} answered ${res.status}. Try again later, or paste the job's text.` };
    return { html, url: res.url || link.href };
  }

  return {
    addJobLink,

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
          db.prepare("DELETE FROM job_unhidden WHERE job_id = ? AND decision_id = ?").run(jobId, decisionId);
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

    async setTarget(jobId, postingId) {
      setTarget(db, jobId, postingId);
      return (await getJob(jobId))!;
    },

    async splitPosting(jobId, postingId) {
      return transaction(db, () => split(db, jobId, postingId, clock.now().toISOString()));
    },

    async queryFeed(query) {
      const sources = count(`SELECT COUNT(*) AS n FROM source WHERE removed_at IS NULL AND ${onWatchlist}`);
      const money = budget();
      // Every Job is built (with its Fit) so counts can leave relocation Jobs out; a personal Feed is small.
      const rows = db.prepare(
        `${jobSelect}
         WHERE j.merged_into IS NULL
         ORDER BY p.posted_at IS NULL, p.posted_at DESC, j.id`,
      ).all();
      const all = rows.map((r) => ({ job: toFeedJob(r, money), changedAt: sqlText(r.state_changed_at) ?? "" }));
      const relocating = (j: FeedJob) => j.fit.place.tier === "relocation";
      // The hidden pile holds hidden Jobs only; every other view leaves them out.
      const inView = (v: FeedView, j: FeedJob) => viewStates[v].includes(j.state) && j.hidden === (v === "hidden");
      const countView = (v: FeedView) =>
        all.filter(({ job }) => inView(v, job) && (v === "passed" || v === "hidden" || !relocating(job))).length;

      let jobs: FeedJob[];
      if (query.view === "passed") {
        jobs = all.filter(({ job }) => inView("passed", job))
          .sort((a, b) => (a.changedAt < b.changedAt ? 1 : a.changedAt > b.changedAt ? -1 : 0))
          .map(({ job }) => job);
      } else {
        const listed = all.map(({ job }) => job).filter((j) => inView(query.view, j));
        const byFit = (a: FeedJob, b: FeedJob) => b.fit.value - a.fit.value;
        if ((query.sort ?? "fit") === "fit") listed.sort(byFit);
        const main = listed.filter((j) => !relocating(j));
        jobs = query.view === "hidden" || query.relocation ? [...main, ...listed.filter(relocating)] : main;
      }
      const ranked = query.view !== "passed" && query.view !== "hidden";
      // Jobs of this view's states that a filter holds back: relocation ones (filter off) and hidden ones.
      const heldBack = ranked ? all.map(({ job }) => job).filter((j) => viewStates[query.view].includes(j.state)) : [];
      return {
        view: query.view,
        asOf: clock.now().toISOString(),
        firstRun: sources === 0 && rows.length === 0,
        jobs,
        counts: {
          new: countView("new"),
          saved: countView("saved"),
          open: countView("open"),
          passed: countView("passed"),
          hidden: countView("hidden"),
          relocation: query.view === "passed" ? 0 : all.filter(({ job }) => inView(query.view, job) && relocating(job)).length,
        },
        filteredToNothing: jobs.length > 0 || !ranked ? null : filteredToNothing(
          query.view,
          query.relocation ? 0 : heldBack.filter((j) => !j.hidden && relocating(j)).length,
          heldBack.filter((j) => j.hidden),
        ),
        health: summary(allSourceHealth()),
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
      const rows = db.prepare(
        `SELECT id, name, kind, config FROM source WHERE removed_at IS NULL AND paused_at IS NULL AND ${onWatchlist} ORDER BY created_at, id`,
      ).all();
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
      return checkOne(liveSource(sourceId), clock.now().toISOString(), mailboxRead());
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
            if ((adapters[String(r.kind)]?.category ?? "ats") === "ats" || adapters[String(r.kind)]?.category === "capture") continue;
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

    async recordCoverageCheck(input) {
      const id = `coverage:${crypto.randomUUID()}`;
      const at = clock.now().toISOString();
      const given = typeof input.listings === "string" ? parseListings(input.listings) : [...input.listings ?? []];
      const resultsUrl = input.resultsUrl?.trim();
      const count = input.resultCount;
      if (!input.site?.trim()) throw new Error("Say which site you searched");
      if (count != null && (!Number.isInteger(count) || count < 0)) throw new Error("The number of results must be a whole number, 0 or more");
      if (count == null && given.length === 0 && !resultsUrl) {
        throw new Error("Type how many results you saw, paste the listings, or paste the results link");
      }
      if (resultsUrl) {
        if (!isReadableResultsPage(resultsUrl)) throw new Error(unreadableResultsPage);
        const res = await fetchFor("devbg")(resultsUrl, { headers: { accept: "text/html" } });
        if (!res.ok) throw new Error(`dev.bg answered ${res.status} for that results page`);
        given.push(...devbgPageListings(await res.text()).map(({ title, company, location, url }) => ({ title, company, location, url })));
      }
      const money = budget();
      const alertSenders = new Set(
        db.prepare("SELECT config FROM source WHERE kind = 'email' AND removed_at IS NULL").all()
          .map((r) => String((JSON.parse(String(r.config)) as { sender?: unknown }).sender)),
      );
      const ctx = { db, site: input.site, sources: companySources(), alertSenders, locations: searchSettings().locations };
      const listings: CoverageResultListing[] = given.map((l) => {
        const hit = matchListing(db, l);
        const jobId = (hit && liveJobId(db, hit.job_id)) ?? null;
        const url = l.url?.trim() || null;
        const listing = { title: l.title.trim(), company: l.company.trim(), location: l.location?.trim() || null, url };
        const row = jobId ? db.prepare(`${jobSelect} WHERE j.id = ?`).get(jobId) : undefined;
        if (jobId && row) {
          const job = toFeedJob(row, money);
          // A link alone is described by the Job it found.
          const described = listing.title ? listing : { title: job.title, company: job.company, location: job.location, url };
          return { ...described, jobId, ...whereFound({ ...job, place: job.fit.place }), fixedBy: null };
        }
        const described = listing.title ? listing : { ...listing, title: url ?? "" };
        return { ...described, status: "missing", jobId: null, ...whyMissing(listing, ctx), fixedBy: null };
      });
      const query = input.query?.trim() ?? "";
      const location = input.location?.trim() || null;
      // With no listings, what apply-kit had is the Jobs (in any view) that answer the same search.
      const appHad = listings.length > 0 ? undefined : db.prepare(`${jobSelect} WHERE j.merged_into IS NULL`).all()
        .filter((r) => answersSearch({ title: String(r.title), company: String(r.company), location: sqlText(r.location) }, query, location)).length;
      const totals = totalsOf(listings, input.resultCount ?? listings.length, appHad);
      const result: CoverageResult = {
        id, at, site: input.site.trim(), query, location, listings, totals,
      };
      transaction(db, () => storeCoverageCheck(db, result));
      return result;
    },

    async coverageHistory() {
      return coverageHistory(db, clock.now(), liveJob);
    },

    async getCoverageCheck(id) {
      return loadCoverageCheck(db, id, liveJob);
    },

    async getSearchSettings() {
      return searchSettings();
    },

    async saveSearchSettings(input) {
      return storeSettings(parseSearchSettings(input));
    },

    async unhide(jobIds) {
      const hidden = jobIds.filter((id) => {
        const row = db.prepare(`${jobSelect} WHERE j.id = ? AND j.merged_into IS NULL`).get(id);
        return row != null && toFeedJob(row).hidden;
      });
      return decide("unhide", hidden, ["new"], "new");
    },

    async notADealbreaker(jobId, reasonKey) {
      const job = await getJob(jobId);
      if (!job) throw new Error(`No job with id "${jobId}"`);
      const reason = job.dealbreakers.find((d) => d.key === reasonKey);
      if (!reason) throw new Error(`"${reasonKey}" isn't a dealbreaker on this job`);
      const before = searchSettings();
      const { after, text } = relaxRule(before, reason, job.screening);
      const id = `rule-change:${crypto.randomUUID()}`;
      transaction(db, () => {
        storeSettings(after);
        db.prepare(
          `INSERT INTO rule_change (id, job_id, rule, reason_key, reason_text, change_text, before_value, after_value, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, job.id, reason.rule, reason.key, reason.text, text, JSON.stringify(before), JSON.stringify(after), clock.now().toISOString());
      });
      return { change: ruleChange(id), settings: after };
    },

    async ruleChanges() {
      return db.prepare("SELECT id FROM rule_change ORDER BY created_at DESC, rowid DESC").all().map((r) => ruleChange(String(r.id)));
    },

    async undoRuleChange(changeId) {
      const row = db.prepare("SELECT rule, reason_key, before_value, undone_at FROM rule_change WHERE id = ?").get(changeId);
      if (!row) throw new Error(`No rule change "${changeId}"`);
      if (row.undone_at != null) return { change: ruleChange(changeId), settings: searchSettings() };
      const restored = restoreRule(searchSettings(), String(row.rule) as DealbreakerRule, String(row.reason_key),
        JSON.parse(String(row.before_value)) as SearchSettings);
      transaction(db, () => {
        storeSettings(restored);
        db.prepare("UPDATE rule_change SET undone_at = ? WHERE id = ?").run(clock.now().toISOString(), changeId);
      });
      return { change: ruleChange(changeId), settings: restored };
    },

    async sourceHealth() {
      const sources = allSourceHealth();
      return { asOf: clock.now().toISOString(), summary: summary(sources), sources };
    },
  };
}

const ruleLabel: Record<DealbreakerRule, string> = {
  language: "a language you don't speak",
  years: "your years limit",
  salary: "your salary minimum",
  location: "your locations",
};
const ruleOrder: DealbreakerRule[] = ["language", "years", "salary", "location"];
const jobsWord = (n: number) => `${n} ${n === 1 ? "job" : "jobs"}`;

/** Why a view is empty: the Relocation filter and the hidden pile, each with how many it holds back. */
function filteredToNothing(view: FeedView, relocation: number, hidden: FeedJob[]): FilteredToNothing | null {
  if (relocation === 0 && hidden.length === 0) return null;
  const byRule = ruleOrder
    .map((rule) => ({ rule, jobs: hidden.filter((j) => j.dealbreakers.some((d) => d.rule === rule)).length }))
    .filter((r) => r.jobs > 0);
  const viewName = { new: "new jobs", saved: "saved jobs", open: "open jobs", passed: "jobs", hidden: "jobs" }[view];
  const parts = [`No ${viewName} to show.`];
  if (relocation > 0) {
    parts.push(`${jobsWord(relocation)} ${relocation === 1 ? "is a relocation job" : "are relocation jobs"}, left out while the Relocation filter is off.`);
  }
  if (hidden.length > 0) {
    const rules = byRule.map((r) => `${r.jobs} by ${ruleLabel[r.rule]}`).join(", ");
    parts.push(`${jobsWord(hidden.length)} ${hidden.length === 1 ? "is" : "are"} hidden by your dealbreakers: ${rules}.`);
  }
  return { relocation, hidden: { total: hidden.length, byRule }, text: parts.join(" ") };
}

const euros = (n: number) => `€${Math.round(n).toLocaleString("en-GB")}`;
const copySettings = (s: SearchSettings): SearchSettings => JSON.parse(JSON.stringify(s)) as SearchSettings;

/** "Not a dealbreaker for me": the settings with the rule behind `reason` relaxed so it no longer hides this Job. */
function relaxRule(before: SearchSettings, reason: HiddenReason, screening: Screening | null): { after: SearchSettings; text: string } {
  const after = copySettings(before);
  const rules = after.dealbreakers;
  switch (reason.rule) {
    case "language": {
      const language = reason.key.slice("language:".length);
      rules.languagesNotSpoken = rules.languagesNotSpoken.filter((l) => l.toLowerCase() !== language.toLowerCase());
      return { after, text: `${language} removed from the languages you don't speak` };
    }
    case "years": {
      const years = screening?.yearsRequired ?? rules.maxYearsRequired;
      const was = rules.maxYearsRequired;
      rules.maxYearsRequired = years;
      return { after, text: `Years limit raised from ${was} to ${years}` };
    }
    case "salary": {
      const money = screening?.salary ? monthlyEur(screening.salary) : null;
      const floor = money ? Math.floor(money.high) : before.minMonthlySalaryEur;
      after.minMonthlySalaryEur = floor;
      return { after, text: `Salary minimum lowered from ${euros(before.minMonthlySalaryEur)} to ${euros(floor)} a month` };
    }
    case "location":
      rules.outsideLocations = false;
      return { after, text: "Jobs outside your locations are no longer hidden (they stay ranked lower)" };
  }
}

/** Undoing a rule change: only that rule goes back to how it was; later changes to other rules stay. */
function restoreRule(current: SearchSettings, rule: DealbreakerRule, key: string, before: SearchSettings): SearchSettings {
  const out = copySettings(current);
  switch (rule) {
    case "language": {
      const language = key.slice("language:".length);
      if (!out.dealbreakers.languagesNotSpoken.some((l) => l.toLowerCase() === language.toLowerCase())) {
        out.dealbreakers.languagesNotSpoken.push(language);
      }
      break;
    }
    case "years": out.dealbreakers.maxYearsRequired = before.dealbreakers.maxYearsRequired; break;
    case "salary": out.minMonthlySalaryEur = before.minMonthlySalaryEur; break;
    case "location": out.dealbreakers.outsideLocations = before.dealbreakers.outsideLocations; break;
  }
  return out;
}

function startNow(start: () => Promise<Response>): Promise<Response> {
  try {
    return start();
  } catch (err) {
    return Promise.reject(err);
  }
}

/**
 * Whether an answer is bot protection rather than the page: a challenge (Cloudflare marks it), a
 * refusal of automated readers, or a captcha page. The app never tries to get past one.
 */
function looksBlocked(res: Response, html: string): boolean {
  if (res.headers.get("cf-mitigated") === "challenge") return true;
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
  const challenge = /just a moment|attention required|are you a (human|robot)|verify you are human|captcha|access denied|pardon our interruption/i;
  if (challenge.test(title)) return true;
  return (res.status === 403 || res.status === 429 || res.status === 503) && /captcha|challenge|bot|automated/i.test(html.slice(0, 20_000));
}

/** Pasted plain text as HTML: one paragraph per line, so the posting reads like any other. */
function textToHtml(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${escapeHtml(l)}</p>`).join("\n");
}

/** The site a link is on, "www." aside ("dev.bg", "job-boards.eu.greenhouse.io"). */
function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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
