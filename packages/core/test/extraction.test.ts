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
