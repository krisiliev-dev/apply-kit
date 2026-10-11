import { describe, expect, it } from "vitest";
import { createScheduler, parseSchedule, type SchedulerOptions } from "../src/index.ts";
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

  it("follows a configured interval and window, read in local time", async () => {
    // 05:00 UTC is 08:00 in Sofia (EEST, UTC+3).
    const { clock, scheduler, checkedAt } = await scheduled("2026-10-12T04:30:00Z", {
      schedule: parseSchedule({ every: "90", window: "08:00-12:00" }),
      timeZone: "Europe/Sofia",
    });

    scheduler.start();
    await clock.advance(12 * hours);
    scheduler.stop();

    // UTC times of 08:00, 09:30 and 11:00 Sofia time; 12:30 is outside the window.
    expect(checkedAt).toEqual(["05:00", "06:30", "08:00"]);
  });

  it("reads schedule settings, defaulting to every 30 minutes from 07:00 to 23:00", () => {
    expect(parseSchedule({})).toEqual({ everyMinutes: 30, window: { start: "07:00", end: "23:00" } });
    expect(parseSchedule({ every: " ", window: "" })).toEqual({ everyMinutes: 30, window: { start: "07:00", end: "23:00" } });
    expect(parseSchedule({ every: "45", window: "6:30-21:15" })).toEqual({ everyMinutes: 45, window: { start: "06:30", end: "21:15" } });
    expect(() => parseSchedule({ every: "0" })).toThrow(/minutes/);
    expect(() => parseSchedule({ window: "23:00-07:00" })).toThrow(/window/);
    expect(() => parseSchedule({ window: "7am-11pm" })).toThrow(/window/);
  });
});
