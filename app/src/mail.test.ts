import { MailboxError } from "@apply-kit/core";
import { describe, expect, it } from "vitest";
import { createImapMailReader, readMailSettings, type ImapClient } from "./mail.ts";

// A synthetic alert email as Gmail serves it over IMAP. Made-up addresses and job.
const rawAlert = [
  "Message-ID: <alert-1@linkedin.example>",
  "Date: Mon, 12 Oct 2026 06:12:00 +0000",
  "From: LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
  "To: sample.jobs@example.com",
  "Subject: =?UTF-8?Q?=E2=80=9Csecurity_engineer=E2=80=9D=3A_Northwind_Labs?=",
  "MIME-Version: 1.0",
  'Content-Type: text/html; charset="utf-8"',
  "",
  '<p><a href="https://www.linkedin.com/comm/jobs/view/4100000001/">Security Engineer</a></p>',
  "",
].join("\r\n");

const settings = { address: "sample.jobs@example.com", appPassword: "abcdefghijklmnop", mailbox: "Job alerts" };

/** A fake IMAP connection that records every call; mutating commands fail the test if ever used. */
function fakeImap(options: { failOn?: "connect" | "lock"; error?: Error; messages?: { uid: number; source: string; internalDate: Date }[] } = {}) {
  const calls: string[] = [];
  const locks: { path: string; options: unknown }[] = [];
  const messages = options.messages ?? [{ uid: 41, source: rawAlert, internalDate: new Date("2026-10-12T06:12:05Z") }];
  const forbidden = (name: string) => () => { throw new Error(`read-only reader called ${name}`); };
  const client: ImapClient & Record<string, unknown> = {
    async connect() {
      calls.push("connect");
      if (options.failOn === "connect") throw options.error;
    },
    async getMailboxLock(path, lockOptions) {
      calls.push("lock");
      locks.push({ path, options: lockOptions });
      if (options.failOn === "lock") throw options.error;
      return { release: () => { calls.push("release"); } };
    },
    async search(query, searchOptions) {
      calls.push(`search since ${query.since.toISOString().slice(0, 10)} uid=${searchOptions.uid}`);
      return messages.map((m) => m.uid);
    },
    async *fetch(range, query, fetchOptions) {
      calls.push(`fetch ${range} source=${query.source} uid=${fetchOptions.uid}`);
      for (const m of messages) yield { uid: m.uid, source: Buffer.from(m.source), internalDate: m.internalDate };
    },
    async logout() { calls.push("logout"); },
    messageFlagsAdd: forbidden("messageFlagsAdd"),
    messageFlagsSet: forbidden("messageFlagsSet"),
    messageDelete: forbidden("messageDelete"),
    messageMove: forbidden("messageMove"),
    mailboxOpen: forbidden("mailboxOpen"),
    append: forbidden("append"),
  };
  return { client, calls, locks };
}

describe("IMAP mail reader", () => {
  it("opens only the configured mailbox, read-only, and reads alert emails without changing anything", async () => {
    const imap = fakeImap();
    let connectedAs: unknown;
    const reader = createImapMailReader(settings, (s) => { connectedAs = s; return imap.client; });

    const emails = await reader.fetchSince(new Date("2026-09-28T07:30:00Z"));

    expect(connectedAs).toEqual(settings);
    expect(imap.locks).toEqual([{ path: "Job alerts", options: { readOnly: true } }]);
    expect(imap.calls).toEqual(["connect", "lock", "search since 2026-09-28 uid=true", "fetch 41 source=true uid=true", "release", "logout"]);
    expect(emails).toEqual([{
      id: "<alert-1@linkedin.example>",
      from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
      subject: "“security engineer”: Northwind Labs",
      receivedAt: new Date("2026-10-12T06:12:05Z"),
      html: expect.stringContaining('href="https://www.linkedin.com/comm/jobs/view/4100000001/"'),
      text: expect.any(String),
    }]);
  });

  it("reports a refused app password as an auth problem and still logs out", async () => {
    const err = Object.assign(new Error("Command failed"), { authenticationFailed: true, responseText: "Invalid credentials (Failure)" });
    const imap = fakeImap({ failOn: "connect", error: err });
    const reader = createImapMailReader(settings, () => imap.client);

    const failure = await reader.fetchSince(new Date()).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(MailboxError);
    expect(failure).toMatchObject({ problem: "auth", message: expect.stringMatching(/Invalid credentials/) });
    expect(imap.calls.at(-1)).toBe("logout");
  });

  it("reports a mailbox folder that doesn't exist", async () => {
    const err = Object.assign(new Error("Command failed"), { serverResponseCode: "NONEXISTENT", responseText: "Unknown Mailbox: Job alerts" });
    const imap = fakeImap({ failOn: "lock", error: err });

    const failure = await createImapMailReader(settings, () => imap.client).fetchSince(new Date()).catch((e: unknown) => e);

    expect(failure).toMatchObject({ problem: "mailbox-missing" });
  });

  it("reports Gmail being unreachable", async () => {
    const imap = fakeImap({ failOn: "connect", error: Object.assign(new Error("getaddrinfo ENOTFOUND imap.gmail.com"), { code: "ENOTFOUND" }) });

    const failure = await createImapMailReader(settings, () => imap.client).fetchSince(new Date()).catch((e: unknown) => e);

    expect(failure).toMatchObject({ problem: "unreachable" });
  });

  it("says the mailbox isn't configured, without connecting, when its settings are missing", async () => {
    let connected = false;
    const reader = createImapMailReader(readMailSettings({}), () => { connected = true; return fakeImap().client; });

    const failure = await reader.fetchSince(new Date()).catch((e: unknown) => e);

    expect(failure).toMatchObject({ problem: "not-configured" });
    expect(connected).toBe(false);
  });

  it("reads settings by name: address, app password without its spaces, mailbox defaulting to INBOX", () => {
    expect(readMailSettings({ GMAIL_ADDRESS: " sample.jobs@example.com ", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" })).toEqual({
      address: "sample.jobs@example.com", appPassword: "abcdefghijklmnop", mailbox: "INBOX",
    });
    expect(readMailSettings({ GMAIL_ADDRESS: "a@example.com", GMAIL_APP_PASSWORD: "x", GMAIL_MAILBOX: "Job alerts" })?.mailbox).toBe("Job alerts");
    expect(readMailSettings({ GMAIL_ADDRESS: "a@example.com" })).toBeNull();
  });
});
