// Dependencies the discovery engine needs from the outside world. The service passes real ones;
// tests pass fakes (see test/harness.ts).
import type { SearchSettings } from "./search-settings.ts";
import type { ExtractionInput, ExtractionResult } from "./extraction/facts.ts";
import type { AiBudget } from "./budget.ts";

export interface Clock {
  now(): Date;
  /** Waits this long (polite gaps between requests). Defaults to a real timer; tests pass fake time. */
  wait?(ms: number): Promise<void>;
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

/** One email from the job mailbox. `id` is its Message-ID, so a re-delivered copy keeps it. */
export interface MailMessage {
  id: string;
  /** The From header as sent: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>". */
  from: string;
  /** Recipients, each as "Name <address>" (or just the address), the way `from` is given. */
  to: string[];
  cc: string[];
  subject: string;
  receivedAt: Date;
  html: string;
  text: string;
  /** The Message-ID this email replies to, if any. */
  inReplyTo: string | null;
  /** The thread's earlier Message-IDs, oldest first (the References header). */
  references: string[];
  /** Attachments by name and media type only; their contents are never read or kept. */
  attachments: MailAttachment[];
}

export interface MailAttachment {
  /** The file name, or null when the email gives none. */
  name: string | null;
  /** The media type, such as "application/pdf". */
  type: string;
}

/** An email as the email-alert Sources read it: any email from the job mailbox. */
export type AlertEmail = MailMessage;

/**
 * Reads every email in the dedicated job mailbox, read-only and only from the configured mailbox
 * folder. Throws a MailboxError when the mailbox can't be read (see mailbox.ts).
 */
export interface MailReader {
  /** Emails received at or after `since` (a reader may return a few earlier ones; IMAP SINCE is by day). */
  fetchSince(since: Date): Promise<MailMessage[]>;
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
  /**
   * Called after each good read of the job mailbox with the emails it stored for the first time
   * (oldest first; none is passed twice). When set, every check reads the mailbox once, even with no
   * email-alert Source; without it, the mailbox is read only for email-alert Sources. Track uses it.
   */
  onMailStored?: (emails: MailMessage[]) => void | Promise<unknown>;
  /** Settings some Sources need, such as API keys. Missing means every setting is unset. */
  settings?: Settings;
  /**
   * Hard monthly cap on AI spending in USD (AI_MONTHLY_CAP_USD). Reading stops before a call
   * would cross it; Postings then stay in the Feed unscreened. Unset or 0 means no AI spending.
   */
  aiMonthlyCapUsd?: number;
  /**
   * The monthly AI budget shared with the preparation engine (see budget.ts). When given, it is the
   * cap and `aiMonthlyCapUsd` is ignored; the service passes one so both engines spend from one cap.
   */
  budget?: AiBudget;
  /** Kris's search settings until he saves his own (the engine stores those). Missing means the defaults. */
  searchSettings?: SearchSettings;
}
