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
    expect(feed.health).toMatchObject({ state: "working", sources: 1 });
    expect(feed.counts.new).toBe(3);
    // Newest first until Fit exists.
    expect(feed.jobs).toEqual([
      { id: expect.any(String), title: "Associate Product Manager", company: "Payhawk", location: "Sofia", salary: null, postedAt: "2026-10-06T08:33:36.000Z", postingCount: 1, siteCount: 1, url: "https://job-boards.eu.greenhouse.io/payhawkio/jobs/4998241101", state: "new", reading: "unread", requirements: [], needsYou: 0 },
      { id: expect.any(String), title: "Customer Support Specialist", company: "Payhawk", location: "Sofia", salary: null, postedAt: "2026-04-21T08:19:01.000Z", postingCount: 1, siteCount: 1, url: "https://job-boards.eu.greenhouse.io/payhawkio/jobs/4512588101", state: "new", reading: "unread", requirements: [], needsYou: 0 },
      { id: expect.any(String), title: "Account Executive", company: "Payhawk", location: "London", salary: null, postedAt: "2023-12-07T14:16:04.000Z", postingCount: 1, siteCount: 1, url: "https://job-boards.eu.greenhouse.io/payhawkio/jobs/4258713101", state: "new", reading: "unread", requirements: [], needsYou: 0 },
    ]);
  });

  it("re-checking an unchanged board later creates no duplicate Postings or Jobs", async () => {
    const { engine, clock } = payhawkEngine();
    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });
    await engine.checkAll();
    const first = await engine.queryFeed({ view: "new" });

    clock.advance(30 * 60_000);
    const again = await engine.checkAll();
    const second = await engine.queryFeed({ view: "new" });

    expect(again.sources[0]).toMatchObject({ ok: true, found: 3, newPostings: 0 });
    expect(second.counts.new).toBe(3);
    expect(second.jobs).toEqual(first.jobs);
  });

  it("gives the same job the same identity whenever and wherever it is found", async () => {
    const a = payhawkEngine();
    const b = payhawkEngine();
    b.clock.set("2027-03-01T12:00:00Z");
    for (const { engine } of [a, b]) {
      await engine.addSource({ kind: "greenhouse", config: "payhawkio" });
      await engine.checkAll();
    }

    const ids = async (t: typeof a) => (await t.engine.queryFeed({ view: "new" })).jobs.map((j) => j.id);
    expect(await ids(b)).toEqual(await ids(a));
  });

  it("adding the same board twice keeps one Source", async () => {
    const { engine } = payhawkEngine();
    const first = await engine.addSource({ kind: "greenhouse", config: "payhawkio" });
    const second = await engine.addSource({ kind: "greenhouse", config: { board: "PayhawkIO" } });

    expect(second).toEqual(first);
    expect((await engine.queryFeed({ view: "new" })).health.sources).toBe(1);
  });

  it("rejects a Greenhouse source without a usable board token", async () => {
    const { engine } = payhawkEngine();
    await expect(engine.addSource({ kind: "greenhouse", config: "https://evil.example/x?y" })).rejects.toThrow(/board token/);
    await expect(engine.addSource({ kind: "nope", config: "x" })).rejects.toThrow(/Unknown source type/);
  });

  it("reports a board that fails to load and leaves the Feed as it was", async () => {
    const { engine, deps } = payhawkEngine();
    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });
    await engine.checkAll();
    deps.fetch = async () => new Response("Service Unavailable", { status: 503 });

    const check = await engine.checkAll();
    const feed = await engine.queryFeed({ view: "new" });

    expect(check.sources).toEqual([
      { sourceId: "greenhouse:payhawkio", name: "payhawkio", ok: false, outcome: "error", error: 'Greenhouse answered 503 for board "payhawkio"' },
    ]);
    expect(feed.counts.new).toBe(3);
  });
});
