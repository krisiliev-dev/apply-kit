import { describe, expect, it } from "vitest";
import { createTestEngine } from "./harness.ts";

describe("discovery engine: Feed query", () => {
  it("shows the first-run Feed when no sources are connected yet", async () => {
    const { engine } = createTestEngine();

    const feed = await engine.queryFeed({ view: "new" });

    expect(feed).toEqual({
      view: "new",
      asOf: "2026-10-12T07:30:00.000Z",
      firstRun: true,
      jobs: [],
      counts: { new: 0, saved: 0, open: 0, passed: 0, hidden: 0 },
      health: { state: "no-sources", sources: 0 },
      ranking: { learnedAdjustments: 0 },
      budget: { month: "2026-10", capUsd: 10, spentUsd: 0, reached: false },
    });
  });
});
