import { describe, expect, it } from "vitest";
import { alertEmail, createTestEngine, fakeMailbox } from "./harness.ts";

// Every sample email is synthetic: made-up companies, jobs, ids and addresses in each sender's real layout.
const linkedin = (id: string, receivedAt: string) => alertEmail("email-linkedin.html", {
  id, receivedAt,
  from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
  subject: "“security engineer”: Northwind Labs - Security Engineer and more",
});

async function withEmailSource(sender: string) {
  const mailbox = fakeMailbox();
  const t = createTestEngine({ mailReader: mailbox });
  const source = await t.engine.addSource({ kind: "email", config: sender });
  return { ...t, mailbox, source };
}

describe("email alerts: LinkedIn", () => {
  it("turns each job in a LinkedIn alert into a Posting with its canonical link", async () => {
    const { engine, mailbox, source } = await withEmailSource("linkedin");
    mailbox.deliver(linkedin("<alert-1@linkedin.example>", "2026-10-12T06:12:00Z"));

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new" });

    expect(source).toEqual({ id: "email:linkedin", kind: "email", name: "LinkedIn job alerts" });
    expect(check.sources).toEqual([expect.objectContaining({ ok: true, found: 3, newPostings: 3 })]);
    expect(feed.jobs.map(({ title, company, location, salary, url }) => ({ title, company, location, salary, url }))).toEqual(
      expect.arrayContaining([
        { title: "Security Engineer", company: "Northwind Labs", location: "Sofia, Sofia City, Bulgaria (Hybrid)", salary: null, url: "https://www.linkedin.com/jobs/view/4100000001/" },
        { title: "Application Security Specialist & Pentester", company: "Contoso Cloud", location: "European Union (Remote)", salary: "€60K/yr - €75K/yr", url: "https://www.linkedin.com/jobs/view/4100000002/" },
        { title: "SOC Analyst", company: "Fabrikam", location: "London, England, United Kingdom (On-site)", salary: null, url: "https://www.linkedin.com/jobs/view/4100000003/" },
      ]),
    );
    expect(feed.jobs).toHaveLength(3);
  });
});

describe("email alerts: no duplicates", () => {
  it("adds nothing for a re-delivered alert, a repeat of the same jobs in a later alert, or a re-read", async () => {
    const { engine, mailbox, clock } = await withEmailSource("linkedin");
    mailbox.deliver(linkedin("<alert-1@linkedin.example>", "2026-10-12T06:12:00Z"));
    await engine.checkAll();

    // The iCloud forward delivers the same email twice, and the next day's alert repeats the same jobs.
    mailbox.deliver(linkedin("<alert-1@linkedin.example>", "2026-10-12T06:13:00Z"));
    clock.set("2026-10-13T07:30:00Z");
    mailbox.deliver(linkedin("<alert-2@linkedin.example>", "2026-10-13T06:12:00Z"));
    const second = await engine.checkAll();
    clock.set("2026-10-13T08:00:00Z");
    const third = await engine.checkAll();

    expect(second.sources).toEqual([expect.objectContaining({ ok: true, newPostings: 0 })]);
    expect(third.sources).toEqual([expect.objectContaining({ ok: true, newPostings: 0 })]);
    const feed = await engine.queryFeed({ view: "new" });
    expect(feed.jobs).toHaveLength(3);
    expect(feed.jobs.every((j) => j.postingCount === 1)).toBe(true);
  });
});
