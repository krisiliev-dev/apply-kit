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

describe("source health: status", () => {
  it("shows a newly added Source as not checked yet", async () => {
    const { engine } = createTestEngine({ fetch: goodFetch });
    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });

    const [source] = (await engine.sourceHealth()).sources;

    expect(source).toMatchObject({ status: "not-checked", failingSince: null, lastGoodCheckAt: null, jobsKept: 0 });
  });

  it("marks a Source failing since its first failure in a row, with the jobs it keeps open", async () => {
    const { engine, deps, clock } = await checkedPayhawk();
    deps.fetch = failures[1]![1];
    clock.set("2026-10-12T08:00:00Z");
    await engine.checkAll();
    clock.set("2026-10-12T08:30:00Z");
    await engine.checkAll();

    const [source] = (await engine.sourceHealth()).sources;

    expect(source).toMatchObject({
      status: "failing",
      failingSince: "2026-10-12T08:00:00.000Z",
      lastGoodCheckAt: "2026-10-12T07:30:00.000Z",
      jobsKept: 3,
    });
  });

  it("is working again once a check succeeds", async () => {
    const { engine, deps, clock } = await checkedPayhawk();
    deps.fetch = failures[2]![1];
    clock.set("2026-10-12T08:00:00Z");
    await engine.checkAll();
    deps.fetch = goodFetch;
    clock.set("2026-10-12T08:30:00Z");
    await engine.checkAll();

    const [source] = (await engine.sourceHealth()).sources;

    expect(source).toMatchObject({ status: "working", failingSince: null, lastGoodCheckAt: "2026-10-12T08:30:00.000Z" });
  });
});

describe("source health: overall summary for the top bar and Feed", () => {
  it("is working with the last check time when every Source answered", async () => {
    const { engine } = await checkedPayhawk();

    const feed = await engine.queryFeed({ view: "new" });

    expect(feed.health).toEqual({ state: "working", sources: 1, lastCheckAt: "2026-10-12T07:30:00.000Z", failing: [] });
  });

  it("is failing and names each failed Source with what it means for the Feed", async () => {
    const { engine, deps, clock } = await checkedPayhawk();
    deps.fetch = failures[1]![1];
    clock.set("2026-10-12T08:00:00Z");
    await engine.checkAll();

    const feed = await engine.queryFeed({ view: "new" });
    const report = await engine.sourceHealth();

    const expected = {
      state: "failing",
      sources: 1,
      lastCheckAt: "2026-10-12T08:00:00.000Z",
      failing: [{
        sourceId: "greenhouse:payhawkio",
        name: "payhawkio",
        outcome: "timeout",
        error: "The operation was aborted due to timeout",
        at: "2026-10-12T08:00:00.000Z",
        since: "2026-10-12T08:00:00.000Z",
        jobsKept: 3,
      }],
    };
    expect(feed.health).toEqual(expected);
    expect(report.summary).toEqual(expected);
  });
});

describe("source health: try one Source now", () => {
  it("retries only the Source asked for and reports its result", async () => {
    const { engine, deps, clock } = await checkedPayhawk();
    await engine.addSource({ kind: "greenhouse", config: "otherboard" });
    deps.fetch = failures[0]![1];
    clock.set("2026-10-12T08:00:00Z");
    await engine.checkAll();

    deps.fetch = goodFetch;
    clock.set("2026-10-12T08:05:00Z");
    const result = await engine.checkSource("greenhouse:payhawkio");
    const report = await engine.sourceHealth();

    expect(result).toEqual({ sourceId: "greenhouse:payhawkio", name: "payhawkio", ok: true, found: 3, newPostings: 0 });
    expect(report.sources.map((s) => [s.id, s.status, s.history[0]!.at])).toEqual([
      ["greenhouse:payhawkio", "working", "2026-10-12T08:05:00.000Z"],
      ["greenhouse:otherboard", "failing", "2026-10-12T08:00:00.000Z"],
    ]);
  });

  it("refuses a Source that doesn't exist", async () => {
    const { engine } = await checkedPayhawk();

    await expect(engine.checkSource("greenhouse:nope")).rejects.toThrow(/No source "greenhouse:nope"/);
  });
});
