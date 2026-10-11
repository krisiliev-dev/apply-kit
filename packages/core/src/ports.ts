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

/** Reads alert emails from the dedicated job mailbox, read-only. */
export interface MailReader {
  fetchSince(since: Date): Promise<{ id: string; from: string; subject: string; receivedAt: Date; html: string; text: string }[]>;
}

/** Named settings (the service reads them from .env). Values are secrets: never log them. */
export interface Settings {
  get(name: string): string | undefined;
}

export interface EngineDeps {
  db: SqlDatabase;
  clock: Clock;
  fetch: typeof fetch;
  extractor: Extractor;
  mailReader: MailReader;
  /** Settings some Sources need, such as API keys. Missing means every setting is unset. */
  settings?: Settings;
}
