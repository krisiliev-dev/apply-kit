import { describe, expect, it } from "vitest";
import { MailboxError } from "../src/index.ts";
import { alertEmail, createTestEngine, fakeClock, fakeMailbox, mailMessage } from "./harness.ts";

// Every email is synthetic: made-up companies, people and addresses.
const confirmation = (id: string, receivedAt: string) => mailMessage({
  id, receivedAt,
  from: "Northwind Labs Recruiting <no-reply@northwind-labs.example>",
  to: ["sample.jobs@example.com"],
  subject: "Thank you for applying to Northwind Labs",
  text: "We received your application for Security Engineer.",
});

const linkedin = (id: string, receivedAt: string) => alertEmail("email-linkedin.html", {
  id, receivedAt, from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", subject: "New jobs for security engineer",
});

describe("job mailbox: the mail store", () => {
  it("keeps every email in the job mailbox once by Message-ID, alerts and application mail alike", async () => {
    const clock = fakeClock("2026-10-12T07:30:00Z");
    const mailbox = fakeMailbox(clock);
    const { engine } = createTestEngine({ clock, mailReader: mailbox });
    await engine.addSource({ kind: "email", config: "linkedin" });
    mailbox.deliver(linkedin("<alert-1@linkedin.example>", "2026-10-12T06:12:00Z"));
    mailbox.deliver(confirmation("<conf-1@northwind-labs.example>", "2026-10-12T06:40:00Z"));
    await engine.checkAll();

    // The forward delivers the confirmation again a minute later, and the next check reads it again.
    mailbox.deliver(confirmation("<conf-1@northwind-labs.example>", "2026-10-12T06:41:00Z"));
    clock.set("2026-10-12T08:00:00Z");
    await engine.checkAll();

    const stored = await engine.storedMail();
    expect(stored.map((m) => [m.id, m.receivedAt.toISOString()])).toEqual([
      ["<alert-1@linkedin.example>", "2026-10-12T06:12:00.000Z"],
      ["<conf-1@northwind-labs.example>", "2026-10-12T06:40:00.000Z"],
    ]);
  });

  it("looks back 30 days on the first read, then from the last good read minus a day; a failed read changes nothing", async () => {
    const clock = fakeClock("2026-10-12T07:30:00Z");
    const mailbox = fakeMailbox(clock);
    const { engine } = createTestEngine({ clock, mailReader: mailbox });
    await engine.addSource({ kind: "email", config: "linkedin" });
    mailbox.deliver(confirmation("<old@northwind-labs.example>", "2026-09-20T09:00:00Z"));
    mailbox.deliver(confirmation("<too-old@northwind-labs.example>", "2026-09-10T09:00:00Z"));
    await engine.checkAll();

    // The app password is revoked for two checks; a rejection arrives meanwhile.
    mailbox.fail(new MailboxError("auth", "Invalid credentials (Failure)"));
    mailbox.deliver(confirmation("<during@northwind-labs.example>", "2026-10-13T10:00:00Z"));
    clock.set("2026-10-13T07:30:00Z");
    await engine.checkAll();
    clock.set("2026-10-14T07:30:00Z");
    await engine.checkAll();
    expect((await engine.storedMail()).map((m) => m.id)).toEqual(["<old@northwind-labs.example>"]);

    mailbox.recover();
    clock.set("2026-10-15T07:30:00Z");
    await engine.checkAll();

    expect(mailbox.reads.map((d) => d.toISOString())).toEqual([
      "2026-09-12T07:30:00.000Z",
      "2026-10-11T07:30:00.000Z",
      "2026-10-11T07:30:00.000Z",
      "2026-10-11T07:30:00.000Z",
    ]);
    expect((await engine.storedMail()).map((m) => m.id)).toEqual(["<old@northwind-labs.example>", "<during@northwind-labs.example>"]);
    expect((await engine.storedMail(new Date("2026-10-01T00:00:00Z"))).map((m) => m.id)).toEqual(["<during@northwind-labs.example>"]);
  });
});

describe("job mailbox: one read per check", () => {
  it("reads the mailbox once per check for every email Source and for whoever waits on new mail", async () => {
    const clock = fakeClock("2026-10-12T07:30:00Z");
    const mailbox = fakeMailbox(clock);
    const received: string[][] = [];
    const { engine } = createTestEngine({ clock, mailReader: mailbox, onMailStored: (mail) => { received.push(mail.map((m) => m.id)); } });
    await engine.addSource({ kind: "email", config: "linkedin" });
    await engine.addSource({ kind: "email", config: "jobsbg" });
    mailbox.deliver(linkedin("<alert-1@linkedin.example>", "2026-10-12T06:12:00Z"));
    mailbox.deliver(confirmation("<conf-1@northwind-labs.example>", "2026-10-12T06:40:00Z"));

    await engine.checkAll();
    mailbox.deliver(confirmation("<conf-1@northwind-labs.example>", "2026-10-12T07:41:00Z"));
    mailbox.deliver(confirmation("<conf-2@northwind-labs.example>", "2026-10-12T07:45:00Z"));
    clock.set("2026-10-12T08:00:00Z");
    await engine.checkAll();

    expect(mailbox.reads).toHaveLength(2);
    expect(received).toEqual([
      ["<alert-1@linkedin.example>", "<conf-1@northwind-labs.example>"],
      ["<conf-2@northwind-labs.example>"],
    ]);
  });

  it("still reads the mailbox once per check for new mail when no email Source is connected", async () => {
    const clock = fakeClock("2026-10-12T07:30:00Z");
    const mailbox = fakeMailbox(clock);
    const received: string[][] = [];
    const { engine } = createTestEngine({ clock, mailReader: mailbox, onMailStored: (mail) => { received.push(mail.map((m) => m.id)); } });
    mailbox.deliver(confirmation("<conf-1@northwind-labs.example>", "2026-10-12T06:40:00Z"));

    await engine.checkAll();

    expect(mailbox.reads).toHaveLength(1);
    expect(received).toEqual([["<conf-1@northwind-labs.example>"]]);
  });

  it("tells no one about new mail when the read fails", async () => {
    const mailbox = fakeMailbox();
    mailbox.fail(new MailboxError("unreachable", "getaddrinfo ENOTFOUND imap.gmail.com"));
    const received: string[][] = [];
    const { engine } = createTestEngine({ mailReader: mailbox, onMailStored: (mail) => { received.push(mail.map((m) => m.id)); } });
    await engine.addSource({ kind: "email", config: "linkedin" });

    const check = await engine.checkAll();

    expect(check.sources).toEqual([expect.objectContaining({ ok: false })]);
    expect(mailbox.reads).toHaveLength(1);
    expect(received).toEqual([]);
  });
});

it("refreshes only job mail while waiting for verification, throttles reads and stores arrivals", async () => {
  const clock = fakeClock("2026-10-16T10:00:00Z");
  const mailbox = fakeMailbox(clock);
  const { engine } = createTestEngine({ clock, mailReader: mailbox });
  mailbox.deliver(confirmation("<verify@northwind-labs.example>", "2026-10-16T09:59:00Z"));
  await engine.refreshMail();
  await engine.refreshMail();
  expect(mailbox.reads).toHaveLength(1);
  expect((await engine.storedMail()).map((m) => m.id)).toEqual(["<verify@northwind-labs.example>"]);
  clock.set("2026-10-16T10:00:10Z");
  await engine.refreshMail();
  expect(mailbox.reads).toHaveLength(2);
});
