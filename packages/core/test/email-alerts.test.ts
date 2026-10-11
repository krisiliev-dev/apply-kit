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

describe("email alerts: jobs.bg", () => {
  it("reads company, location and pay from each card, following tracking links to the job", async () => {
    const { engine, mailbox, source } = await withEmailSource("jobsbg");
    mailbox.deliver(alertEmail("email-jobsbg.html", {
      id: "<sub-1@jobs.bg.example>", receivedAt: "2026-10-11T15:40:00Z",
      from: "JOBS.BG <noreply@jobs.bg>", subject: "2 нови обяви по абонамента ти „Информационна сигурност, София“",
    }));

    await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new" });

    expect(source.name).toBe("jobs.bg alerts");
    expect(feed.jobs.map(({ title, company, location, salary, url }) => ({ title, company, location, salary, url }))).toEqual([
      { title: "Специалист Информационна сигурност", company: "Примерна Банка АД", location: "София; Хибридна работа", salary: "Заплата от 3500 до 5000 BGN (Бруто)", url: "https://www.jobs.bg/job/8000001" },
      { title: "Junior SOC Analyst", company: "Тестова Технологии ЕООД", location: "Пловдив", salary: null, url: "https://www.jobs.bg/job/8000002" },
    ]);
  });
});

/** The Feed's jobs reduced to what an alert can tell us. */
async function feedFacts(engine: Awaited<ReturnType<typeof withEmailSource>>["engine"]) {
  const feed = await engine.queryFeed({ view: "new" });
  return feed.jobs.map(({ title, company, location, salary, url }) => ({ title, company, location, salary, url }));
}

describe("email alerts: Google Careers", () => {
  it("reads each job with the Google company that posted it, without tracking parameters", async () => {
    const { engine, mailbox, source } = await withEmailSource("google");
    mailbox.deliver(alertEmail("email-google.html", {
      id: "<alert-g1@google.example>", receivedAt: "2026-10-10T09:00:00Z",
      from: "Google Careers <careers-noreply@google.com>", subject: "New jobs that match your alert: security",
    }));

    await engine.checkAll();

    expect(source.name).toBe("Google Careers alerts");
    expect(await feedFacts(engine)).toEqual([
      { title: "Security Engineer, Cloud", company: "Google", location: "Zürich, Switzerland; Munich, Germany", salary: null, url: "https://www.google.com/about/careers/applications/jobs/results/100000000000000001-security-engineer-cloud" },
      { title: "Detection and Response Analyst", company: "YouTube", location: "Warsaw, Poland", salary: null, url: "https://www.google.com/about/careers/applications/jobs/results/100000000000000002-detection-and-response-analyst" },
    ]);
  });

  it("leaves other Google mail alone", async () => {
    const { engine, mailbox } = await withEmailSource("google");
    mailbox.deliver(alertEmail("email-google.html", {
      id: "<security@accounts.google.example>", receivedAt: "2026-10-10T09:00:00Z",
      from: "Google <no-reply@accounts.google.com>", subject: "Security alert",
    }));

    const check = await engine.checkAll();

    expect(check.sources).toEqual([expect.objectContaining({ ok: true, found: 0 })]);
  });
});

describe("email alerts: Workday", () => {
  it("reads jobs from any company's Workday alert, named after the sending company", async () => {
    const { engine, mailbox, source } = await withEmailSource("workday");
    mailbox.deliver(alertEmail("email-workday.html", {
      id: "<alert-w1@myworkday.example>", receivedAt: "2026-10-12T05:00:00Z",
      from: "Tailspin Systems <tailspin@myworkday.com>", subject: "New Jobs Posted: Security - Bulgaria",
    }));

    await engine.checkAll();

    expect(source.name).toBe("Workday job alerts");
    expect(await feedFacts(engine)).toEqual([
      { title: "Cyber Security Analyst", company: "Tailspin Systems", location: "Sofia, Bulgaria", salary: null, url: "https://tailspin.wd3.myworkdayjobs.com/TailspinCareers/job/Sofia-Bulgaria/Cyber-Security-Analyst_R-0012345" },
      { title: "Senior IAM Engineer", company: "Tailspin Systems", location: "Remote - Europe", salary: null, url: "https://tailspin.wd3.myworkdayjobs.com/TailspinCareers/job/Remote---Europe/Senior-IAM-Engineer_R-0012399" },
    ]);
  });
});
