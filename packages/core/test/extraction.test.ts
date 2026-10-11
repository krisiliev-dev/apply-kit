import { describe, expect, it } from "vitest";
import type { PostingFacts } from "../src/index.ts";
import { cannedFacts, createTestEngine, fakeExtractor, fixtureFetch } from "./harness.ts";

const kestrelBoard = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs?content=true";

const q = (quote: string, translation: string | null = null) => ({ quote, translation });

/** What a careful read of the Security Engineer fixture gives. */
const securityEngineer: PostingFacts = cannedFacts({
  requirements: [
    { text: "3+ years in security operations", kind: "required", category: "experience", source: q("You have 3+ years in a security operations or SOC role"), confidence: 0.95 },
    { text: "Splunk or Elastic", kind: "required", category: "skill", source: q("Hands-on with Splunk or Elastic"), confidence: 0.95 },
    { text: "Kubernetes security", kind: "required", category: "skill", source: q("Experience securing Kubernetes workloads"), confidence: 0.9 },
    { text: "CISSP", kind: "preferred", category: "certificate", source: q("CISSP or a similar certification"), confidence: 0.9 },
  ],
  years: [
    { min: 3, max: null, about: "security operations", kind: "required", source: q("You have 3+ years in a security operations or SOC role"), confidence: 0.95 },
  ],
  languages: [
    { language: "English", level: "professional", kind: "required", source: q("Professional English: our working language is English"), confidence: 0.95 },
  ],
  remote: { mode: "hybrid", summary: "Hybrid: 2 days a week at Business Park Sofia", locations: ["Sofia"], source: q("We work hybrid, two days a week together at Business Park Sofia."), confidence: 0.9 },
  workAuthorisation: { summary: "No visa sponsorship", visaSponsorship: "not-offered", source: q("We are unable to sponsor visas for this role."), confidence: 0.95 },
});

function kestrelEngine(extractor = fakeExtractor({ "Security Engineer": securityEngineer }), overrides = {}) {
  const t = createTestEngine({ fetch: fixtureFetch({ [kestrelBoard]: "greenhouse-kestrel.json" }), extractor, ...overrides });
  return { ...t, extractor };
}

async function checked(t: ReturnType<typeof kestrelEngine>) {
  await t.engine.addSource({ kind: "greenhouse", config: "kestrel" });
  await t.engine.checkAll();
  return t;
}

describe("reading postings: requirements in the Feed", () => {
  it("shows each Job's requirements on its Feed row once the posting has been read", async () => {
    const { engine } = await checked(kestrelEngine());

    await engine.readPending();
    const feed = await engine.queryFeed({ view: "new" });
    const row = feed.jobs.find((j) => j.title === "Security Engineer")!;

    expect(row.reading).toBe("read");
    // No master profile yet, so whether Kris meets them is unknown rather than guessed.
    expect(row.requirements).toEqual([
      { text: "3+ years in security operations", kind: "required", status: "unknown", needsYou: false },
      { text: "Splunk or Elastic", kind: "required", status: "unknown", needsYou: false },
      { text: "Kubernetes security", kind: "required", status: "unknown", needsYou: false },
      { text: "CISSP", kind: "preferred", status: "unknown", needsYou: false },
    ]);
  });
});

async function jobId(t: ReturnType<typeof kestrelEngine>, title: string) {
  return (await t.engine.queryFeed({ view: "new" })).jobs.find((j) => j.title === title)!.id;
}

describe("reading postings: the Job view", () => {
  it("gives every key fact and requirement the line it came from and a confidence", async () => {
    const t = await checked(kestrelEngine());
    await t.engine.readPending();

    const job = (await t.engine.getJob(await jobId(t, "Security Engineer")))!;

    expect(job.reading).toEqual({ state: "read", error: null });
    expect(job.keyFacts).toEqual([
      { key: "years:0", label: "Experience", value: "3+ years in security operations", confidence: 0.95, needsYou: false,
        source: { quote: "You have 3+ years in a security operations or SOC role", translation: null, line: 3 } },
      { key: "languages:0", label: "Language", value: "English, professional", confidence: 0.95, needsYou: false,
        source: { quote: "Professional English: our working language is English", translation: null, line: 6 } },
      { key: "remote", label: "Remote rules", value: "Hybrid: 2 days a week at Business Park Sofia", confidence: 0.9, needsYou: false,
        source: { quote: "We work hybrid, two days a week together at Business Park Sofia.", translation: null, line: 10 } },
      { key: "workAuthorisation", label: "Work authorisation", value: "No visa sponsorship", confidence: 0.95, needsYou: false,
        source: { quote: "We are unable to sponsor visas for this role.", translation: null, line: 12 } },
      { key: "salary", label: "Salary", value: "Not stated", confidence: 1, needsYou: false, source: null },
    ]);
    expect(job.requirements[3]).toEqual({
      key: "requirements:3", text: "CISSP", askedAs: "Preferred", kind: "preferred", status: "unknown", needsYou: false, confidence: 0.9,
      source: { quote: "CISSP or a similar certification", translation: null, line: 8 },
    });
    expect(job.postingText.split("\n")[2]).toBe("• You have 3+ years in a security operations or SOC role");
  });

  it("answers null for a Job that doesn't exist", async () => {
    const t = await checked(kestrelEngine());
    expect(await t.engine.getJob("job:nope")).toBeNull();
  });
});

/** The same posting read less confidently: an unclear salary, two year counts, one requirement of doubtful kind. */
const unsure: PostingFacts = {
  ...securityEngineer,
  requirements: securityEngineer.requirements.map((r) => (r.text === "Kubernetes security" ? { ...r, confidence: 0.5 } : r)),
  years: [
    ...securityEngineer.years,
    { min: 5, max: null, about: "a SOC or CERT", kind: "required", source: q("Ideally 5+ years working in a SOC or CERT"), confidence: 0.4 },
  ],
  salary: { stated: true, min: 5500, max: 7000, currency: "BGN", period: "month", basis: "gross", source: q("Package: 5.5–7k + annual bonus, paid monthly."), confidence: 0.3 },
};

describe("reading postings: low-confidence facts", () => {
  it("asks Kris about low-confidence facts and screens with the cautious reading meanwhile", async () => {
    const t = await checked(kestrelEngine(fakeExtractor({ "Security Engineer": unsure })));
    await t.engine.readPending();
    const id = await jobId(t, "Security Engineer");

    const job = (await t.engine.getJob(id))!;
    const row = (await t.engine.queryFeed({ view: "new" })).jobs.find((j) => j.id === id)!;

    expect(job.needsYou).toEqual([
      { key: "requirements:2", label: "Requirement", question: "Is \"Kubernetes security\" required?",
        extracted: "Required: Kubernetes security", cautious: "Preferred: Kubernetes security",
        source: { quote: "Experience securing Kubernetes workloads", translation: null, line: 5 } },
      { key: "years:1", label: "Experience", question: "Years of experience: is this one required?",
        extracted: "Required: 5+ years in a SOC or CERT", cautious: "Preferred: 5+ years in a SOC or CERT",
        source: { quote: "Ideally 5+ years working in a SOC or CERT", translation: null, line: 9 } },
      { key: "salary", label: "Salary", question: "Salary: couldn't read it reliably",
        extracted: "5,500–7,000 BGN gross/month", cautious: "Not stated",
        source: { quote: "Package: 5.5–7k + annual bonus, paid monthly.", translation: null, line: 11 } },
    ]);
    // Meanwhile: the doubtful requirement can't count against the job, the lower year count is the
    // requirement, and the salary counts as not stated.
    expect(job.requirements[2]).toMatchObject({ askedAs: "Unclear", kind: "preferred", needsYou: true });
    expect(job.keyFacts.find((f) => f.key === "salary")).toMatchObject({ value: "Not stated", needsYou: true });
    expect(job.screening).toEqual({
      yearsRequired: 3,
      languagesRequired: ["English"],
      certificatesRequired: [],
      salary: null,
      remote: { mode: "hybrid", locations: ["Sofia"] },
      visaSponsorship: "not-offered",
      provisional: true,
    });
    expect(row.needsYou).toBe(3);
    expect(row.requirements[2]).toEqual({ text: "Kubernetes security", kind: "preferred", status: "unknown", needsYou: true });
  });

  it("flags a fact whose quote can't be found in the posting, however confident the model was", async () => {
    const invented: PostingFacts = {
      ...securityEngineer,
      certificates: [{ name: "OSCP", kind: "required", source: q("OSCP certification is mandatory"), confidence: 0.99 }],
    };
    const t = await checked(kestrelEngine(fakeExtractor({ "Security Engineer": invented })));
    await t.engine.readPending();

    const job = (await t.engine.getJob(await jobId(t, "Security Engineer")))!;

    expect(job.keyFacts.find((f) => f.key === "certificates:0")).toMatchObject({
      value: "OSCP (preferred)", needsYou: true, source: { line: null },
    });
    expect(job.needsYou.map((n) => n.key)).toEqual(["certificates:0"]);
    expect(job.screening!.certificatesRequired).toEqual([]);
  });
});

describe("reading postings: Kris confirms a fact", () => {
  it("uses Kris's answer for that job and stops asking", async () => {
    const t = await checked(kestrelEngine(fakeExtractor({ "Security Engineer": unsure })));
    await t.engine.readPending();
    const id = await jobId(t, "Security Engineer");

    await t.engine.confirmFact(id, "salary", "extracted");
    await t.engine.confirmFact(id, "years:1", "cautious");
    await t.engine.confirmFact(id, "requirements:2", "extracted");
    await t.clock.advance(30 * 60_000);
    await t.engine.checkAll();
    const job = (await t.engine.getJob(id))!;

    expect(job.needsYou).toEqual([]);
    expect(job.keyFacts.find((f) => f.key === "salary")).toMatchObject({ value: "5,500–7,000 BGN gross/month", needsYou: false });
    expect(job.keyFacts.find((f) => f.key === "years:1")).toMatchObject({ value: "5+ years in a SOC or CERT (preferred)", needsYou: false });
    expect(job.requirements[2]).toMatchObject({ askedAs: "Required", kind: "required", needsYou: false });
    expect(job.screening).toMatchObject({ yearsRequired: 3, salary: { min: 5500, max: 7000, currency: "BGN" }, provisional: false });
    expect((await t.engine.queryFeed({ view: "new" })).jobs.find((j) => j.id === id)!.needsYou).toBe(0);
  });

  it("refuses an answer for a fact that isn't waiting for Kris", async () => {
    const t = await checked(kestrelEngine(fakeExtractor({ "Security Engineer": unsure })));
    await t.engine.readPending();
    const id = await jobId(t, "Security Engineer");

    await expect(t.engine.confirmFact(id, "remote", "extracted")).rejects.toThrow(/doesn't need/);
    await expect(t.engine.confirmFact("job:nope", "salary", "extracted")).rejects.toThrow(/No job/);
  });
});
