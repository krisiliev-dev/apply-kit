// The real mail reader: the dedicated Gmail job mailbox over IMAP, read-only. It opens one folder
// (GMAIL_MAILBOX, default INBOX) with EXAMINE, so the server can't mark anything read, move or delete
// it, and it only ever searches and fetches. Message bodies are fetched with BODY.PEEK by imapflow.
import { MailboxError, type AlertEmail, type MailboxProblem, type MailReader } from "@apply-kit/core";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export interface MailSettings {
  address: string;
  appPassword: string;
  /** The one folder read: INBOX, or a Gmail label. */
  mailbox: string;
}

/** The only IMAP commands the reader is allowed: connect, open read-only, search, fetch, log out. */
export interface ImapClient {
  connect(): Promise<void>;
  getMailboxLock(path: string, options: { readOnly: true }): Promise<{ release(): void }>;
  search(query: { since: Date }, options: { uid: true }): Promise<number[] | false | undefined | object>;
  fetch(range: string, query: { uid: true; source: true; internalDate: true }, options: { uid: true }): AsyncIterable<{ uid: number; source?: Buffer; internalDate?: Date | string }>;
  logout(): Promise<void>;
}

export type ImapConnect = (settings: MailSettings) => ImapClient;

/** Newest emails read per check at most; a dedicated alert mailbox gets a handful a day. */
const maxEmails = 300;

/** GMAIL_ADDRESS, GMAIL_APP_PASSWORD (Google shows it with spaces; they're dropped) and optional GMAIL_MAILBOX. */
export function readMailSettings(env: Record<string, string | undefined>): MailSettings | null {
  const address = env.GMAIL_ADDRESS?.trim();
  const appPassword = env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!address || !appPassword) return null;
  return { address, appPassword, mailbox: env.GMAIL_MAILBOX?.trim() || "INBOX" };
}

export const connectGmail: ImapConnect = (s) =>
  new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: s.address, pass: s.appPassword },
    logger: false,
  });

export function createImapMailReader(settings: MailSettings | null, connect: ImapConnect = connectGmail): MailReader {
  return {
    async fetchSince(since) {
      if (!settings) throw new MailboxError("not-configured", "GMAIL_ADDRESS and GMAIL_APP_PASSWORD are not set");
      const client = connect(settings);
      try {
        await client.connect();
        const lock = await client.getMailboxLock(settings.mailbox, { readOnly: true });
        try {
          const found = await client.search({ since }, { uid: true });
          const uids = Array.isArray(found) ? found.slice(-maxEmails) : [];
          if (uids.length === 0) return [];
          const emails: AlertEmail[] = [];
          for await (const msg of client.fetch(uids.join(","), { uid: true, source: true, internalDate: true }, { uid: true })) {
            if (msg.source) emails.push(await toAlertEmail(msg.uid, msg.source, msg.internalDate));
          }
          return emails;
        } finally {
          lock.release();
        }
      } catch (err) {
        throw err instanceof MailboxError ? err : new MailboxError(classify(err), describe(err));
      } finally {
        await client.logout().catch(() => {});
      }
    },
  };
}

async function toAlertEmail(uid: number, source: Buffer, internalDate: Date | string | undefined): Promise<AlertEmail> {
  const mail = await simpleParser(source);
  return {
    id: mail.messageId ?? `uid:${uid}`,
    from: fromHeader(mail.from?.value[0]),
    subject: mail.subject ?? "",
    receivedAt: internalDate ? new Date(internalDate) : (mail.date ?? new Date(0)),
    html: typeof mail.html === "string" ? mail.html : (mail.textAsHtml ?? ""),
    text: mail.text ?? "",
  };
}

/** "Name <address>", unquoted, as the core's sender matching reads it. */
function fromHeader(a: { name?: string; address?: string } | undefined): string {
  if (!a?.address) return a?.name ?? "";
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

type ImapError = { authenticationFailed?: boolean; serverResponseCode?: string; responseText?: string; code?: string; message?: string };

function classify(err: unknown): MailboxProblem {
  const e = (err ?? {}) as ImapError;
  const text = `${e.responseText ?? ""} ${e.message ?? ""}`;
  if (e.authenticationFailed || /AUTHENTICATIONFAILED|invalid credentials|application-specific password/i.test(text)) return "auth";
  if (e.serverResponseCode === "NONEXISTENT" || /NONEXISTENT|unknown mailbox/i.test(text)) return "mailbox-missing";
  if (/^(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ETIMEOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|CONNECT_TIMEOUT|NoConnection)$/.test(e.code ?? "")) return "unreachable";
  return "error";
}

/** The server's own words when it gave any; never includes the password. */
function describe(err: unknown): string {
  const e = (err ?? {}) as ImapError;
  return e.responseText?.trim() || e.message || String(err);
}
