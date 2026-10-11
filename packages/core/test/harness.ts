// Test harness for the discovery engine: fake clock, in-memory database, fixture loader,
// and fakes for every injected dependency. Tests drive the engine only through its public interface.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createEngine, type EngineDeps, type Clock } from "../src/index.ts";

const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** Reads a recorded response, alert email or captured page from test/fixtures. */
export function loadFixture(name: string): string {
  return readFileSync(fixturesDir + name, "utf8");
}

export interface FakeClock extends Clock {
  advance(ms: number): void;
  set(iso: string): void;
}

export function fakeClock(startIso = "2026-10-12T07:30:00Z"): FakeClock {
  let t = new Date(startIso).getTime();
  return {
    now: () => new Date(t),
    advance: (ms) => { t += ms; },
    set: (iso) => { t = new Date(iso).getTime(); },
  };
}

export function memoryDb(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

/** A fetch that answers only from the given URL → fixture map and fails loudly on anything else. */
export function fixtureFetch(routes: Record<string, string> = {}): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const fixture = routes[url];
    if (!fixture) throw new Error(`fixtureFetch: no fixture for ${url}`);
    return new Response(loadFixture(fixture), { status: 200 });
  };
}

export function createTestEngine(overrides: Partial<EngineDeps> = {}) {
  const clock = fakeClock();
  const deps: EngineDeps = {
    db: memoryDb(),
    clock,
    fetch: fixtureFetch(),
    extractor: { extract: async () => { throw new Error("fake extractor: no canned facts set"); } },
    mailReader: { fetchSince: async () => [] },
    ...overrides,
  };
  return { engine: createEngine(deps), clock, deps };
}
