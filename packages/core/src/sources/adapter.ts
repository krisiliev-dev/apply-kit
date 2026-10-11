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
}

/** What sort of Source this is, as the Sources screen groups them. */
export type SourceCategory = "ats" | "api" | "aggregator" | "email" | "capture";

export interface SourceAdapter<Config = unknown> {
  /** Stored as source.kind; never rename once shipped. */
  readonly kind: string;
  readonly category: SourceCategory;
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

export function isEmailAlertAdapter(a: SourceAdapter<unknown>): a is EmailAlertAdapter<unknown> {
  return a.category === "email" && "parseEmail" in a;
}
