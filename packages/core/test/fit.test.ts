import { describe, expect, it } from "vitest";
import type { FeedJob, PostingFacts } from "../src/index.ts";
import { cannedFacts, createTestEngine, fakeExtractor } from "./harness.ts";

interface BoardJob {
  title: string;
  location?: string | null;
  /** ISO date the job was first published. */
  posted?: string | null;
  text?: string;
}

/** An engine with one Greenhouse board listing `jobs`, read by a fake extractor with `facts` per title. */
async function feedOf(jobs: BoardJob[], facts: Record<string, PostingFacts> = {}, { read = true } = {}) {
  const board = {
    jobs: jobs.map((j, i) => ({
      id: i + 1,
      title: j.title,
      absolute_url: `https://example.test/jobs/${i + 1}`,
      company_name: "Example Co",
      location: { name: j.location === undefined ? "Sofia, Bulgaria" : j.location },
      first_published: j.posted === undefined ? "2026-10-11T09:00:00Z" : j.posted,
      content: `&lt;p&gt;${j.text ?? `About the ${j.title} role.`}&lt;/p&gt;`,
    })),
  };
  const t = createTestEngine({ fetch: async () => Response.json(board), extractor: fakeExtractor(facts) });
  await t.engine.addSource({ kind: "greenhouse", config: "example" });
  await t.engine.checkAll();
  if (read) await t.engine.readPending();
  return t;
}

const row = (jobs: FeedJob[], title: string) => jobs.find((j) => j.title === title)!;

describe("Fit: every Job gets a Fit with its reasons", () => {
  it("gives each Feed row a Fit from 0 to 100 with a reason for every part of it", async () => {
    const { engine } = await feedOf([{ title: "Security Engineer" }]);

    const { jobs } = await engine.queryFeed({ view: "new" });
    const fit = jobs[0]!.fit;

    expect(fit.value).toBeGreaterThanOrEqual(0);
    expect(fit.value).toBeLessThanOrEqual(100);
    expect(fit.reasons.map((r) => r.factor)).toEqual(["requirements", "angle", "location", "salary", "freshness"]);
    // The points of every reason add up to the Fit.
    expect(Math.round(fit.reasons.reduce((n, r) => n + r.points, 0))).toBe(fit.value);
  });

  it("orders the Feed by Fit, best first", async () => {
    const { engine } = await feedOf([
      { title: "Office Manager", location: "Plovdiv" },
      { title: "Security Engineer", location: "Sofia, Bulgaria" },
      { title: "Frontend Developer", location: "Remote, US" },
    ]);

    const { jobs } = await engine.queryFeed({ view: "new" });

    expect(jobs.map((j) => j.title)).toEqual(["Security Engineer", "Frontend Developer", "Office Manager"]);
    expect(jobs[0]!.fit.value).toBeGreaterThan(jobs[1]!.fit.value);
    expect(jobs[1]!.fit.value).toBeGreaterThan(jobs[2]!.fit.value);
  });
});

void cannedFacts;
void row;
