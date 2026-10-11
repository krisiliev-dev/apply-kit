import { describe, expect, it } from "vitest";
import { createTestEngine, fixtureFetch } from "./harness.ts";

const board = (b: string) => `https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true`;

describe("Polite polling", () => {
  it("sends one request at a time to a host, even when several Sources share it", async () => {
    const { engine, deps } = createTestEngine();
    const routes = fixtureFetch({ [board("one")]: "greenhouse-payhawkio.json", [board("two")]: "greenhouse-payhawkio.json", [board("three")]: "greenhouse-payhawkio.json" });
    let inFlight = 0;
    let most = 0;
    const agents: (string | null)[] = [];
    deps.fetch = async (input, init) => {
      inFlight++;
      most = Math.max(most, inFlight);
      agents.push(new Headers(init?.headers).get("user-agent"));
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return routes(input, init);
    };
    for (const b of ["one", "two", "three"]) await engine.addSource({ kind: "greenhouse", config: b });

    const check = await engine.checkAll();

    expect(check.sources.every((s) => s.ok)).toBe(true);
    expect(most).toBe(1);
    expect(agents.every((a) => a?.startsWith("apply-kit/"))).toBe(true);
  });
});
