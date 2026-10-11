// Dependencies the discovery engine needs from the outside world. The service passes real ones;
// tests pass fakes (see test/harness.ts).

export interface Clock {
  now(): Date;
}

/** Repeating timers, injected so the scheduler can be driven by a fake clock in tests. */
export interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/**
 * The slice of a synchronous SQLite connection the engine uses. `node:sqlite`'s DatabaseSync
 * satisfies it; tests use an in-memory one.
 */
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}

export type SqlValue = null | number | bigint | string | Uint8Array;

export interface SqlStatement {
  run(...params: SqlValue[]): unknown;
  get(...params: SqlValue[]): Record<string, unknown> | undefined;
  all(...params: SqlValue[]): Record<string, unknown>[];
}

/** Turns posting text into structured facts (AI seam). Shape is settled by the extraction ticket. */
export interface Extractor {
  extract(posting: { text: string; language?: string }): Promise<unknown>;
}

/** One email from the job mailbox. `id` is its Message-ID, so a re-delivered copy keeps it. */
export interface AlertEmail {
  id: string;
  /** The From header as sent: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>". */
  from: string;
  subject: string;
  receivedAt: Date;
  html: string;
  text: string;
}

/**
 * Reads alert emails from the dedicated job mailbox, read-only and only from the configured
 * mailbox folder. Throws a MailboxError when the mailbox can't be read (see mailbox.ts).
 */
export interface MailReader {
  /** Emails received at or after `since` (a reader may return a few earlier ones; IMAP SINCE is by day). */
  fetchSince(since: Date): Promise<AlertEmail[]>;
}

export interface EngineDeps {
  db: SqlDatabase;
  clock: Clock;
  fetch: typeof fetch;
  extractor: Extractor;
  mailReader: MailReader;
}
