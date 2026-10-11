// Dependencies the discovery engine needs from the outside world. The service passes real ones;
// tests pass fakes (see test/harness.ts).
import type { ExtractionInput, ExtractionResult } from "./extraction/facts.ts";

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

/**
 * Turns one Posting's text into structured facts (the AI seam). The service passes the OpenRouter
 * implementation; tests pass a fake with canned facts. See extraction/facts.ts for the fact shape.
 */
export interface Extractor {
  /**
   * A cautious (high) estimate of what extracting this input will cost in USD. The engine checks it
   * against what is left of the monthly budget before calling `extract`; it must not do any I/O.
   */
  estimateCostUsd(input: ExtractionInput): number;
  /**
   * Reads the posting. Throws on any failure (timeout, refusal, output that doesn't fit the schema);
   * the engine records the failure and retries at a later read. An error may carry a numeric
   * `costUsd` if the failed call was still billed.
   */
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

/** Reads alert emails from the dedicated job mailbox, read-only. */
export interface MailReader {
  fetchSince(since: Date): Promise<{ id: string; from: string; subject: string; receivedAt: Date; html: string; text: string }[]>;
}

export interface EngineDeps {
  db: SqlDatabase;
  clock: Clock;
  fetch: typeof fetch;
  extractor: Extractor;
  mailReader: MailReader;
  /**
   * Hard monthly cap on AI spending in USD (AI_MONTHLY_CAP_USD). Reading stops before a call
   * would cross it; Postings then stay in the Feed unscreened. Unset or 0 means no AI spending.
   */
  aiMonthlyCapUsd?: number;
}
