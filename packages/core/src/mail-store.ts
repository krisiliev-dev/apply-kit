// The mail store (ADR 0004): every email in the job mailbox kept once, by Message-ID, in the local
// database. One read of the mailbox per check fills it; Discover's alert Sources and Track both read
// from it, so the mailbox is never read twice and the two features agree about what arrived.
import { mailboxProblemOf } from "./mailbox.ts";
import type { Clock, MailMessage, MailReader, SqlDatabase } from "./ports.ts";

const dayMs = 24 * 60 * 60_000;
/** How far back the first read looks. */
export const firstReadLookbackMs = 30 * dayMs;
/** Later reads start this long before the last good read, so mail that arrived late (IMAP SINCE is by day) isn't missed. */
export const readOverlapMs = dayMs;

export interface MailStore {
  /**
   * Reads the job mailbox once and stores every email not stored yet. Returns the emails stored by
   * this read (new ones only). Throws the reader's MailboxError; a failed read stores nothing and
   * doesn't move where the next read starts, so the next good read catches up.
   */
  read(): Promise<MailMessage[]>;
  /** Stored emails received at or after `since` (all of them without it), oldest first. */
  since(since?: Date): MailMessage[];
}

export function createMailStore(db: SqlDatabase, clock: Clock, reader: MailReader): MailStore {
  return {
    async read() {
      const at = clock.now().toISOString();
      const lastGood = db.prepare("SELECT MAX(read_at) AS at FROM mailbox_read WHERE outcome = 'ok' AND since IS NOT NULL").get()?.at;
      const since = lastGood == null
        ? new Date(clock.now().getTime() - firstReadLookbackMs)
        : new Date(Date.parse(String(lastGood)) - readOverlapMs);
      const record = db.prepare("INSERT INTO mailbox_read (read_at, outcome, reason, error, emails, since) VALUES (?, ?, ?, ?, ?, ?)");
      let emails: MailMessage[];
      try {
        emails = await reader.fetchSince(since);
      } catch (err) {
        record.run(at, "error", mailboxProblemOf(err), err instanceof Error ? err.message : String(err), null, since.toISOString());
        throw err;
      }
      const insert = db.prepare(
        `INSERT OR IGNORE INTO mail_message
           (id, from_header, to_list, cc_list, subject, received_at, html, text, in_reply_to, reference_list, attachments, stored_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const stored: MailMessage[] = [];
      db.exec("BEGIN");
      try {
        for (const m of emails) {
          const result = insert.run(
            m.id, m.from, JSON.stringify(m.to), JSON.stringify(m.cc), m.subject, m.receivedAt.toISOString(), m.html, m.text,
            m.inReplyTo, JSON.stringify(m.references), JSON.stringify(m.attachments), at,
          ) as { changes?: number | bigint } | undefined;
          if (Number(result?.changes ?? 0) > 0) stored.push(m);
        }
        record.run(at, "ok", null, null, emails.length, since.toISOString());
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return stored;
    },

    since(since) {
      return db.prepare(
        "SELECT * FROM mail_message WHERE received_at >= ? ORDER BY received_at, id",
      ).all(since ? since.toISOString() : "").map(storedMessage);
    },
  };
}

/** A stored email (a mail_message row) as the reader gave it. */
export function storedMessage(r: Record<string, unknown>): MailMessage {
  return {
    id: String(r.id),
    from: String(r.from_header),
    to: JSON.parse(String(r.to_list)) as string[],
    cc: JSON.parse(String(r.cc_list)) as string[],
    subject: String(r.subject),
    receivedAt: new Date(String(r.received_at)),
    html: String(r.html),
    text: String(r.text),
    inReplyTo: r.in_reply_to == null ? null : String(r.in_reply_to),
    references: JSON.parse(String(r.reference_list)) as string[],
    attachments: JSON.parse(String(r.attachments)) as MailMessage["attachments"],
  };
}
