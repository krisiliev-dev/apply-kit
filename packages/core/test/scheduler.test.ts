import { describe, expect, it } from "vitest";
import { createScheduler, type SchedulerOptions } from "../src/index.ts";
import { createTestEngine, fakeClock, fixtureFetch } from "./harness.ts";

const payhawkBoard = "https://boards-api.greenhouse.io/v1/boards/payhawkio/jobs?content=true";
const minutes = 60_000;
const hours = 60 * minutes;

/** An engine with one Source whose board fetches are logged (by clock time) so tests can see when checks ran. */
async function scheduled(startIso: string, options: Partial<SchedulerOptions> = {}) {
  const clock = fakeClock(startIso);
  const checkedAt: string[] = [];
  const fixtures = fixtureFetch({ [payhawkBoard]: "greenhouse-payhawkio.json" });
  const fetch: typeof globalThis.fetch = (input, init) => {
    checkedAt.push(clock.now().toISOString().slice(11, 16));
    return fixtures(input, init);
  };
  const t = createTestEngine({ clock, fetch });
  await t.engine.addSource({ kind: "greenhouse", config: "payhawkio" });
  const scheduler = createScheduler({ engine: t.engine, clock, timers: clock, timeZone: "UTC", ...options });
  return { ...t, clock, scheduler, checkedAt };
}

describe("scheduler", () => {
  it("checks every 30 minutes from 07:00 until 23:00 by default", async () => {
    const { clock, scheduler, checkedAt } = await scheduled("2026-10-12T06:50:00Z");

    scheduler.start();
    await clock.advance(24 * hours);
    scheduler.stop();

    expect(checkedAt.slice(0, 3)).toEqual(["07:00", "07:30", "08:00"]);
    expect(checkedAt.at(-1)).toBe("22:30");
    expect(checkedAt).toHaveLength(32);
  });
});
