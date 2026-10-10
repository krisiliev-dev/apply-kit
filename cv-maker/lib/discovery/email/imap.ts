import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

// Reads recent job-alert emails from the user's own Gmail over IMAP. The user
// opts into LinkedIn / jobs.bg saved-search alerts and (optionally) filters
// them to a label; we read that mailbox. This processes mail the platforms
// chose to send the user — no site scraping.
//
// Idempotent: we fetch the last N days each run and rely on the pool's id
// dedupe, so nothing is lost and re-syncing doesn't duplicate.

export type AlertEmail = {
  from: string;
  subject: string;
  html: string;
  date?: number;
};

export function emailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export async function fetchRecentAlerts(opts?: {
  mailbox?: string;
  days?: number;
  max?: number;
}): Promise<AlertEmail[]> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      "GMAIL_USER / GMAIL_APP_PASSWORD not set in .env.local (see docs/email-alerts.md).",
    );
  }
  const mailbox = opts?.mailbox || process.env.GMAIL_MAILBOX || "INBOX";
  const days = opts?.days ?? 14;
  const max = opts?.max ?? 60;

  const client = new ImapFlow({
    host: process.env.GMAIL_IMAP_HOST || "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const out: AlertEmail[] = [];
  await client.connect();
  const lock = await client.getMailboxLock(mailbox);
  try {
    const since = new Date(Date.now() - days * 86_400_000);
    const found = await client.search({ since }, { uid: true });
    const uids = Array.isArray(found) ? found.slice(-max) : [];
    if (uids.length === 0) return out;
    for await (const msg of client.fetch(uids, { source: true }, { uid: true })) {
      if (!msg.source) continue;
      try {
        const p = await simpleParser(msg.source);
        const html =
          typeof p.html === "string" ? p.html : p.textAsHtml || "";
        if (!html) continue;
        out.push({
          from: p.from?.text || "",
          subject: p.subject || "",
          html,
          date: p.date ? p.date.getTime() : undefined,
        });
      } catch {
        // skip unparseable message
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return out;
}
