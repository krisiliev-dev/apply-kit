import { describe, expect, it } from "vitest";
import type { SourceCheck } from "../src/index.ts";
import { createTestEngine, fixtureFetch } from "./harness.ts";

const payhawkBoard = "https://boards-api.greenhouse.io/v1/boards/payhawkio/jobs?content=true";
const slowBoard = "https://boards-api.greenhouse.io/v1/boards/slowco/jobs?content=true";

/** A fetch where the slowco board answers only when the test releases it. */
function heldFetch() {
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const fixtures = fixtureFetch({ [payhawkBoard]: "greenhouse-payhawkio.json" });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === slowBoard) {
      await held;
      return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    }
    return fixtures(input, init);
  };
  return { fetch, release };
}

describe("discovery engine: a check in progress", () => {
  it("reports each Source as it finishes and its jobs reach the Feed before the slower ones are done", async () => {
    const { fetch, release } = heldFetch();
    const { engine } = createTestEngine({ fetch });
    await engine.addSource({ kind: "greenhouse", config: "payhawkio" });
    await engine.addSource({ kind: "greenhouse", config: "slowco" });
    const finished: SourceCheck[] = [];

    const check = engine.checkAll({ onSourceChecked: (s) => finished.push(s) });
    await waitUntil(() => finished.length === 1);
    const midway = await engine.queryFeed({ view: "new" });

    expect(finished).toEqual([{ sourceId: "greenhouse:payhawkio", name: "payhawkio", ok: true, found: 3, newPostings: 3 }]);
    expect(midway.counts.new).toBe(3);

    release();
    const result = await check;
    expect(finished.map((s) => s.sourceId)).toEqual(["greenhouse:payhawkio", "greenhouse:slowco"]);
    expect(result.sources).toHaveLength(2);
  });
});

async function waitUntil(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setImmediate(r));
  if (!cond()) throw new Error("condition never became true");
}
