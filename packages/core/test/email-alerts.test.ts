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
