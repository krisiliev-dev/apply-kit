// The Source adapter contract. One adapter per Source type (Greenhouse, Lever, Ashby, ...).
// Adapters only translate a Source's own format into FoundPostings; the engine owns storage,
// identity, merging into Jobs, expiry and health. Adapters never touch the database or the clock.
import type { AlertEmail } from "../ports.ts";

/** One Posting as a Source lists it right now, already normalised. */
export interface FoundPosting {
  /**
   * The Source's own identifier for this posting, stable across checks (Greenhouse job id,
   * Lever posting id, ...). Never derived from timestamps, list order or anything that changes
   * when the posting is re-fetched. If a Source has no id, derive one from its canonical URL.
   */
  externalId: string;
  /** Where a person reads (and usually applies to) this posting. */
  url: string;
  title: string;
  company: string;
  /** The location text as the Source states it, or null if absent. */
  location: string | null;
  /** Salary text as stated by the Source's structured data, or null if not stated. */
  salary: string | null;
  /** When the Source says it was first published (ISO 8601, UTC), or null if unknown. */
  postedAt: string | null;
  /** The posting body as HTML (entities decoded), or null if the list response has none. */
  descriptionHtml: string | null;
}

export interface AdapterContext {
  fetch: typeof fetch;
  /**
   * The job mailbox's emails for this check (email-alert Sources only). One read is shared by every
   * email Source in a check. Throws a MailboxError if the mailbox can't be read.
   */
  mail?: () => Promise<AlertEmail[]>;
  /**
   * Reads a setting by name (e.g. "JOOBLE_API_KEY"), or undefined if it isn't set. Adapters that
   * need a key throw a readable error naming the missing setting, so the Source shows as failing
   * with that message instead of crashing anything. Never put a setting's value in an error.
   */
  setting(name: string): string | undefined;
  /**
   * Says this Check listed only part of the Source (it stopped at a page limit): the postings it
   * didn't reach aren't gone, so the engine expires nothing from this Check.
   */
  incomplete?(): void;
}

/** What sort of Source this is, as the Sources screen groups them. */
export type SourceCategory = "ats" | "api" | "aggregator" | "email" | "capture";

export interface SourceAdapter<Config = unknown> {
  /** Stored as source.kind; never rename once shipped. */
  readonly kind: string;
  readonly category: SourceCategory;
  /** The Source type's name as the Sources screen shows it ("dev.bg", "EURES"). Defaults to the kind. */
  readonly label?: string;
  /**
   * Minimum gap between two requests to this Source type's host, across all its Sources (the host's
   * robots.txt Crawl-delay, e.g. Lever's 1 s). The engine already sends one request at a time per host.
   */
  readonly crawlDelayMs?: number;
  /**
   * True for a search whose answer is capped (a keyword search returns its top N): a Posting missing
   * from one Check may simply have fallen below the cap, so the engine never treats it as gone.
   * Leave unset for a Source that lists everything or fails (an ATS board, Workday).
   */
  readonly capped?: boolean;
  /**
   * Validates config and returns it normalised. Accepts the adapter's config object or a
   * shorthand string (for Greenhouse, the board token). Throws an Error with a readable message.
   */
  parseConfig(raw: unknown): Config;
  /**
   * Identity of the Source within its kind, from config only (for Greenhouse, the board token).
   * The Source id is `${kind}:${key}`, so adding the same Source twice is a no-op.
   */
  key(config: Config): string;
  /** Name shown before anything better is known. */
  defaultName(config: Config): string;
  /**
   * One check: every posting the Source currently lists. Must throw on any failure (network
   * error, non-2xx, unparseable body). Returning [] means "the Source really lists nothing".
   */
  fetchPostings(config: Config, ctx: AdapterContext): Promise<FoundPosting[]>;
}

/**
 * An email-alert Source (category "email"): its postings come from alert emails in the job mailbox,
 * not from a request. The engine reads the mailbox once per check, records which emails belong to
 * each Source (for its usual rhythm and "quiet longer than usual"), and asks the adapter to parse them.
 */
export interface EmailAlertAdapter<Config = unknown> extends SourceAdapter<Config> {
  readonly category: "email";
  /** Whether this Source's sender sent the email. */
  isFrom(config: Config, email: AlertEmail): boolean;
  /** Every job the email lists, with stable ids, so a repeated or re-delivered alert adds nothing. */
  parseEmail(config: Config, email: AlertEmail): FoundPosting[];
}

/**
 * Whether a Check of this Source type lists every posting it has, so one it no longer lists is gone.
 * Not for capped searches, nor for alert emails and captures, which only ever show some postings.
 */
export function listsEverything(a: SourceAdapter<unknown>): boolean {
  return a.capped !== true && a.category !== "email" && a.category !== "capture";
}

export function isEmailAlertAdapter(a: SourceAdapter<unknown>): a is EmailAlertAdapter<unknown> {
  return a.category === "email" && "parseEmail" in a;
}
