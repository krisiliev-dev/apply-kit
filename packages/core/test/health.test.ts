import { describe, expect, it } from "vitest";
import { createTestEngine, fixtureFetch } from "./harness.ts";

const payhawkBoard = "https://boards-api.greenhouse.io/v1/boards/payhawkio/jobs?content=true";
const goodFetch = fixtureFetch({ [payhawkBoard]: "greenhouse-payhawkio.json" });

const failures: [outcome: string, fetch: typeof fetch][] = [
  ["error", async () => new Response("Service Unavailable", { status: 503 })],
  ["timeout", async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }],
  ["rate-limited", async () => new Response("Too Many Requests", { status: 429 })],
];

async function checkedPayhawk() {
  const t = createTestEngine({ fetch: goodFetch });
  await t.engine.addSource({ kind: "greenhouse", config: "payhawkio" });
  await t.engine.checkAll();
  return t;
}

describe("source health: failure safety", () => {
  it.each(failures)("a failed check (%s) leaves every Posting and Job exactly as it was", async (outcome, failingFetch) => {
    const { engine, deps, clock } = await checkedPayhawk();
    const views = ["new", "saved", "open", "passed"] as const;
    const before = await Promise.all(views.map((view) => engine.queryFeed({ view })));

    clock.advance(30 * 60_000);
    deps.fetch = failingFetch;
    const check = await engine.checkAll();
    const after = await Promise.all(views.map((view) => engine.queryFeed({ view })));

    expect(check.sources).toEqual([expect.objectContaining({ sourceId: "greenhouse:payhawkio", ok: false, outcome })]);
    after.forEach((feed, i) => {
      expect(feed.jobs).toEqual(before[i]!.jobs);
      expect(feed.counts).toEqual(before[i]!.counts);
    });
  });
});

describe("source health: check history", () => {
  it("records every check with its time, outcome, count in your locations and total", async () => {
    const { engine, deps, clock } = await checkedPayhawk();
    clock.set("2026-10-12T08:00:00Z");
    deps.fetch = failures[0]![1];
    await engine.checkAll();

    const health = await engine.sourceHealth();

    expect(health.sources).toHaveLength(1);
    expect(health.sources[0]).toMatchObject({
      id: "greenhouse:payhawkio",
      name: "payhawkio",
      kind: "greenhouse",
      category: "ats",
      history: [
        { at: "2026-10-12T08:00:00.000Z", outcome: "error", inLocations: null, total: null, error: 'Greenhouse answered 503 for board "payhawkio"' },
        // The fixture lists two Sofia jobs and one in London.
        { at: "2026-10-12T07:30:00.000Z", outcome: "ok", inLocations: 2, total: 3, error: null },
      ],
    });
  });
});
