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
}

export interface SourceAdapter<Config = unknown> {
  /** Stored as source.kind; never rename once shipped. */
  readonly kind: string;
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
