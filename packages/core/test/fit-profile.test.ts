import { describe, expect, it } from "vitest";
import type { ExtractedRequirement, FeedJob, PieceInput } from "../src/index.ts";
import { defaultSearchSettings } from "../src/index.ts";
import { cannedFacts, fakeExtractor } from "./harness.ts";
import { createTestPreparation } from "./preparation-harness.ts";

// Fit from the master profile (ticket #60), at the engine seam: both engines on one database, a
// fake extractor with canned facts and the fake writer. No live AI. Made-up person only: Mira
// Petrova, with fictional employers.

const quote = (q: string) => ({ quote: q, translation: null });
const requirement = (text: string, kind: "required" | "preferred", category: ExtractedRequirement["category"]): ExtractedRequirement =>
  ({ text, kind, category, source: quote(text), confidence: 0.95 });

const postingText = "3+ years in security operations. Kubernetes. CISSP preferred. English, professional.";
const securityEngineer = cannedFacts({
  requirements: [
    requirement("3+ years in security operations", "required", "experience"),
    requirement("Kubernetes", "required", "skill"),
    requirement("CISSP", "preferred", "certificate"),
    requirement("English, professional", "required", "language"),
  ],
});

/** Both engines with one Greenhouse job, read; nothing is hidden (dealbreakers are tested elsewhere). */
async function withJob() {
  const board = {
    jobs: [{
      id: 1, title: "Security Engineer", absolute_url: "https://example.test/jobs/1", company_name: "Example Co",
      location: { name: "Sofia, Bulgaria" }, first_published: "2026-10-11T09:00:00Z", content: `&lt;p&gt;${postingText}&lt;/p&gt;`,
    }],
  };
  const settings = { ...defaultSearchSettings, dealbreakers: { languagesNotSpoken: [], maxYearsRequired: null, salaryBelowMinimum: false, outsideLocations: false } };
  const t = createTestPreparation({ fetch: async () => Response.json(board), extractor: fakeExtractor({ "Security Engineer": securityEngineer }) });
  await t.discovery.saveSearchSettings(settings);
  await t.discovery.addSource({ kind: "greenhouse", config: "example" });
  await t.discovery.checkAll();
  await t.discovery.readPending();
  const save = (input: PieceInput) => {
    const r = t.preparation.savePiece(input);
    if (!r.saved) throw new Error(r.problems[0]!.message);
    return r.piece.id;
  };
  const feedRow = async () => (await t.discovery.queryFeed({ view: "new" })).jobs[0]!;
  return { ...t, save, feedRow };
}

/** Mira's profile: a current security role since 2023 and a SOC internship, and English at C1. */
function addMira(save: (input: PieceInput) => string) {
  const analyst = save({ kind: "role", text: "", entry: { title: "Junior Security Analyst", organisation: "Orbital Bank", city: "Sofia", start: "2023-07", end: null }, angles: ["security"] });
  save({ kind: "role", text: "", entry: { title: "SOC Intern", organisation: "Varna Telecom", city: "Varna", start: "2022-06", end: "2022-09" }, angles: ["security"] });
  save({ kind: "achievement", belongsTo: analyst, text: "Part of the response to phishing incidents.", tags: ["incident response"], angles: ["security"] });
  save({ kind: "skill", text: "English (C1)" });
  return { analyst };
}

const statuses = (job: Pick<FeedJob, "requirements">) => Object.fromEntries(job.requirements.map((r) => [r.text, r.status]));

describe("Fit from the master profile", () => {
  it("marks each requirement met, gap or not held from the master profile", async () => {
    const t = await withJob();
    addMira(t.save);

    const row = await t.feedRow();

    expect(statuses(row)).toEqual({
      "3+ years in security operations": "met",
      "Kubernetes": "gap",
      "CISSP": "not-held",
      "English, professional": "met",
    });
    expect(row.fit.gaps).toEqual(["Kubernetes"]);
  });
});
