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
