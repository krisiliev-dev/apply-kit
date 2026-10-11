import { describe, expect, it } from "vitest";
import { MailboxError } from "../src/index.ts";
import { alertEmail, createTestEngine, fakeMailbox } from "./harness.ts";

const linkedin = (id: string, receivedAt: string) => alertEmail("email-linkedin.html", {
  id, receivedAt, from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", subject: "New jobs for security engineer",
});

async function twoEmailSources() {
  const mailbox = fakeMailbox();
  const t = createTestEngine({ mailReader: mailbox });
  await t.engine.addSource({ kind: "email", config: "linkedin" });
  await t.engine.addSource({ kind: "email", config: "jobsbg" });
  mailbox.deliver(linkedin("<alert-1@linkedin.example>", "2026-10-12T06:12:00Z"));
  await t.engine.checkAll();
  return { ...t, mailbox };
}

describe("job mailbox errors", () => {
  it("shows an expired app password once, on the mailbox, with how to fix it; jobs stay as they were", async () => {
    const { engine, mailbox, clock } = await twoEmailSources();
    const before = await engine.queryFeed({ view: "open" });

    clock.set("2026-10-12T08:00:00Z");
    mailbox.fail(new MailboxError("auth", "Invalid credentials (Failure)"));
    const check = await engine.checkAll();
    const report = await engine.sourceHealth();
    const feed = await engine.queryFeed({ view: "open" });

    expect(check.sources.every((s) => !s.ok)).toBe(true);
    expect(feed.jobs).toEqual(before.jobs);
    expect(report.summary.state).toBe("failing");
    expect(report.summary.failing).toEqual([]);
    expect(report.summary.mailbox).toMatchObject({
      state: "error", problem: "auth", since: "2026-10-12T08:00:00.000Z", lastReadAt: "2026-10-12T07:30:00.000Z",
      lastEmailAt: "2026-10-12T06:12:00.000Z", error: "Invalid credentials (Failure)",
    });
    expect(report.summary.mailbox?.fix).toMatch(/app password/i);
    expect(report.summary.mailbox?.fix).toContain("GMAIL_APP_PASSWORD");
    expect(feed.health.mailbox).toEqual(report.summary.mailbox);
  });

  it("is connected again after the next good read", async () => {
    const { engine, mailbox, clock } = await twoEmailSources();
    mailbox.fail(new MailboxError("auth", "Invalid credentials (Failure)"));
    clock.set("2026-10-12T08:00:00Z");
    await engine.checkAll();

    mailbox.recover();
    clock.set("2026-10-12T08:30:00Z");
    await engine.checkAll();
    const { summary } = await engine.sourceHealth();

    expect(summary.state).toBe("working");
    expect(summary.mailbox).toEqual({
      state: "connected", problem: null, error: null, fix: null, since: null,
      lastReadAt: "2026-10-12T08:30:00.000Z", lastEmailAt: "2026-10-12T06:12:00.000Z",
    });
  });

  it("says how to set the mailbox up when it isn't configured", async () => {
    const mailbox = fakeMailbox();
    mailbox.fail(new MailboxError("not-configured", "GMAIL_ADDRESS and GMAIL_APP_PASSWORD are not set"));
    const { engine } = createTestEngine({ mailReader: mailbox });
    await engine.addSource({ kind: "email", config: "google" });
    await engine.checkAll();

    const { summary } = await engine.sourceHealth();

    expect(summary.mailbox).toMatchObject({ state: "error", problem: "not-configured" });
    expect(summary.mailbox?.fix).toMatch(/GMAIL_ADDRESS.*GMAIL_APP_PASSWORD/);
  });

  it("has no mailbox status when no email-alert Source is connected, and never reads the mailbox", async () => {
    const mailbox = fakeMailbox();
    const { engine } = createTestEngine({ mailReader: mailbox });

    await engine.checkAll();

    expect((await engine.sourceHealth()).summary.mailbox).toBeNull();
    expect(mailbox.reads).toEqual([]);
  });
});
