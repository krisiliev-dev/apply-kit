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

  describe("after the laptop wakes", () => {
    it("catches up straight away with one check when checks were missed", async () => {
      const { clock, scheduler, checkedAt } = await scheduled("2026-10-12T09:00:00Z");
      scheduler.start();
      await clock.advance(10 * minutes);

      clock.sleep(2 * hours + 37 * minutes); // lid closed at 09:10, opened at 11:47
      await clock.advance(31 * minutes);
      scheduler.stop();

      expect(checkedAt).toEqual(["09:00", "11:47", "12:17"]);
    });

    it("waits for the window when it wakes before 07:00", async () => {
      const { clock, scheduler, checkedAt } = await scheduled("2026-10-12T22:30:00Z");
      scheduler.start();
      await clock.advance(10 * minutes);

      clock.sleep(7 * hours + 30 * minutes); // asleep 22:40 → 06:10
      await clock.advance(51 * minutes);
      scheduler.stop();

      expect(checkedAt).toEqual(["22:30", "07:00"]);
    });

    it("adds no extra check when none was missed during a short sleep", async () => {
      const { clock, scheduler, checkedAt } = await scheduled("2026-10-12T09:00:00Z");
      scheduler.start();
      await clock.advance(5 * minutes);

      clock.sleep(15 * minutes); // asleep 09:05 → 09:20
      await clock.advance(15 * minutes);
      scheduler.stop();

      expect(checkedAt).toEqual(["09:00", "09:30"]);
    });
  });

  describe("a check in progress", () => {
    /** Two boards whose answers the test releases one at a time. */
    async function twoHeldBoards() {
      const clock = fakeClock("2026-10-12T07:00:00Z");
      const gates = new Map<string, () => void>();
      const fixtures = fixtureFetch({ [payhawkBoard]: "greenhouse-payhawkio.json" });
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const url = String(input);
        const board = /boards\/([^/]+)\/jobs/.exec(url)![1]!;
        await new Promise<void>((r) => gates.set(board, r));
        return url === payhawkBoard ? fixtures(input, init) : new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      };
      const t = createTestEngine({ clock, fetch });
      await t.engine.addSource({ kind: "greenhouse", config: "payhawkio" });
      await t.engine.addSource({ kind: "greenhouse", config: "slowco" });
      const scheduler = createScheduler({ engine: t.engine, clock, timers: clock, timeZone: "UTC" });
      const answer = async (board: string) => { gates.get(board)!(); await clock.advance(0); };
      return { clock, scheduler, answer };
    }

    it("shows how many Sources are done, the new jobs so far and when it should finish", async () => {
      const { clock, scheduler, answer } = await twoHeldBoards();

      const check = scheduler.checkNow();
      await clock.advance(0);
      expect(scheduler.status().checking).toEqual({
        startedAt: "2026-10-12T07:00:00.000Z", total: 2, done: 0, newJobs: 0, failed: 0, estimatedEndAt: null,
      });

      await clock.advance(20_000);
      await answer("payhawkio");
      // One of two Sources took 20 s, so the other should be done around 20 s later.
      expect(scheduler.status().checking).toEqual({
        startedAt: "2026-10-12T07:00:00.000Z", total: 2, done: 1, newJobs: 3, failed: 0, estimatedEndAt: "2026-10-12T07:00:40.000Z",
      });

      await clock.advance(10_000);
      await answer("slowco");
      await check;
      expect(scheduler.status().checking).toBeNull();
      expect(scheduler.status().lastCheck).toMatchObject({
        startedAt: "2026-10-12T07:00:00.000Z", finishedAt: "2026-10-12T07:00:30.000Z", sources: [{ ok: true }, { ok: true }],
      });
    });

    it("estimates the next check from how long the last one took before any Source is done", async () => {
      const { clock, scheduler, answer } = await twoHeldBoards();
      const first = scheduler.checkNow();
      await clock.advance(30_000);
      await answer("payhawkio");
      await answer("slowco");
      await first;

      await clock.advance(30 * minutes);
      void scheduler.checkNow();
      await clock.advance(0);

      expect(scheduler.status().checking).toMatchObject({ startedAt: "2026-10-12T07:30:30.000Z", done: 0, estimatedEndAt: "2026-10-12T07:31:00.000Z" });
      await answer("payhawkio");
      await answer("slowco");
    });

    it("joins the check already running instead of starting a second one", async () => {
      const { clock, scheduler, answer } = await twoHeldBoards();

      const a = scheduler.checkNow();
      await clock.advance(0);
      const b = scheduler.checkNow();
      await answer("payhawkio");
      await answer("slowco");

      expect(await b).toBe(await a);
    });
  });
});
