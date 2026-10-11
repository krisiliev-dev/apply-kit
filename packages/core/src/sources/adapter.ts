// The Source adapter contract. One adapter per Source type (Greenhouse, Lever, Ashby, ...).
// Adapters only translate a Source's own format into FoundPostings; the engine owns storage,
// identity, merging into Jobs, expiry and health. Adapters never touch the database or the clock.

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
   * Reads a setting by name (e.g. "JOOBLE_API_KEY"), or undefined if it isn't set. Adapters that
   * need a key throw a readable error naming the missing setting, so the Source shows as failing
   * with that message instead of crashing anything. Never put a setting's value in an error.
   */
  setting(name: string): string | undefined;
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
