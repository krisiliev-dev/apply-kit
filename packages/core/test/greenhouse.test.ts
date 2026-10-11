import { describe, expect, it } from "vitest";
import { createTestEngine, fixtureFetch } from "./harness.ts";

const payhawkBoard = "https://boards-api.greenhouse.io/v1/boards/payhawkio/jobs?content=true";

function payhawkEngine() {
  const t = createTestEngine({ fetch: fixtureFetch({ [payhawkBoard]: "greenhouse-payhawkio.json" }) });
  return t;
}

describe("Greenhouse source", () => {
  it("lists a Greenhouse company's jobs in the Feed after a check", async () => {
    const { engine } = payhawkEngine();
    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new" });

    expect(check.sources).toEqual([{ sourceId: "greenhouse:payhawkio", name: "payhawkio", ok: true, found: 3, newPostings: 3 }]);
    expect(feed.firstRun).toBe(false);
    expect(feed.health).toEqual({ state: "working", sources: 1 });
    expect(feed.counts.new).toBe(3);
    // Newest first until Fit exists.
    expect(feed.jobs.map(({ id: _id, ...j }) => j)).toEqual([
      { title: "Associate Product Manager", company: "Payhawk", location: "Sofia", salary: null, postedAt: "2026-10-06T08:33:36.000Z", postingCount: 1, url: "https://job-boards.eu.greenhouse.io/payhawkio/jobs/4998241101" },
      { title: "Customer Support Specialist", company: "Payhawk", location: "Sofia", salary: null, postedAt: "2026-04-21T08:19:01.000Z", postingCount: 1, url: "https://job-boards.eu.greenhouse.io/payhawkio/jobs/4512588101" },
      { title: "Account Executive", company: "Payhawk", location: "London", salary: null, postedAt: "2023-12-07T14:16:04.000Z", postingCount: 1, url: "https://job-boards.eu.greenhouse.io/payhawkio/jobs/4258713101" },
    ]);
  });
});
