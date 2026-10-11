// Adding a company by name or careers link: detecting its job system, the not-found fallbacks.
import { describe, expect, it } from "vitest";
import { createTestEngine } from "./harness.ts";
import { routedFetch, type Answer } from "./http.ts";

const notFound = () => new Response('{"error":"Not Found"}', { status: 404 });

/** A fetch where only the given URLs exist; every other request is a 404, like an unknown board. */
function onlyThese(routes: Record<string, Answer>) {
  return routedFetch((req) => routes[req.url] ?? notFound());
}

const greenhouse = (board: string) => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`;

describe("adding a company: detecting its job system", () => {
  it("finds a company's Greenhouse board from its name, with its open jobs and how many are in Kris's locations", async () => {
    const http = onlyThese({ [greenhouse("payhawk")]: { fixture: "greenhouse-payhawkio.json" } });
    const { engine } = createTestEngine({ fetch: http.fetch });

    const found = await engine.detectCompany("Payhawk");

    expect(found.company).toBe("Payhawk");
    expect(found.systems.find((s) => s.kind === "greenhouse")).toMatchObject({
      label: "Greenhouse",
      status: "found",
      tried: "payhawk",
      openJobs: 3,
      inLocations: 2,
      source: { kind: "greenhouse", config: { board: "payhawk" }, name: "Payhawk" },
    });
    expect(found.systems.find((s) => s.kind === "lever")).toMatchObject({ status: "not-found", tried: "payhawk" });
    expect(found.fallbacks).toEqual([]);
  });
});
