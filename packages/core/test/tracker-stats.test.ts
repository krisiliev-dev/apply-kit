// Stats, at the tracker's public interface: applications per week with the pace, the response rate,
// interviews and what's working. Fake clock (Mon 12 Oct 2026, 10:30 in Sofia), in-memory database.
import { describe, expect, it } from "vitest";
import { createTracker, type Status } from "../src/index.ts";
import { createTestEngine } from "./harness.ts";

function tracked() {
  const t = createTestEngine();
  const tracker = createTracker({ db: t.deps.db, clock: t.clock, discovery: t.engine });
  return { ...t, tracker };
}
type Tracker = ReturnType<typeof tracked>["tracker"];

/** Adds an Application made elsewhere and returns its id. */
async function add(tracker: Tracker, appliedOn: string, status: Exclude<Status, "accepted"> = "applied", company = "Fennel Studio") {
  const r = await tracker.addByHand({ job: { company, title: "UX Engineer" }, appliedOn, status });
  if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
  return r.application.id;
}

/** Adds `n` Applications on one day. */
async function addMany(tracker: Tracker, n: number, appliedOn: string) {
  for (let i = 0; i < n; i++) await add(tracker, appliedOn);
}

describe("applications per week", () => {
  it("counts the last 9 weeks, Monday to Sunday, by date applied; this week is the last", async () => {
    const { tracker } = tracked();
    await add(tracker, "2026-08-17"); // Monday of the oldest week shown
    await add(tracker, "2026-08-16"); // the Sunday before: too old to show
    await addMany(tracker, 2, "2026-10-11"); // Sunday: last week
    await add(tracker, "2026-10-12"); // Monday: this week

    const { weeks, thisWeek } = await tracker.stats();

    expect(weeks.map((w) => w.weekOf)).toEqual([
      "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12",
    ]);
    expect(weeks.map((w) => w.count)).toEqual([1, 0, 0, 0, 0, 0, 0, 2, 1]);
    expect(thisWeek.count).toBe(1);
  });

  it("starts a new week at midnight on Monday in Sofia, not in UTC", async () => {
    const { tracker, clock } = tracked();
    await add(tracker, "2026-10-12");

    clock.set("2026-10-18T20:30:00Z"); // Sunday 23:30 in Sofia (UTC+3)
    expect((await tracker.stats()).weeks.at(-1)).toEqual({ weekOf: "2026-10-12", count: 1, current: true });

    clock.set("2026-10-18T21:30:00Z"); // Monday 00:30 in Sofia, still Sunday in UTC
    const after = await tracker.stats();
    expect(after.weeks.at(-1)).toEqual({ weekOf: "2026-10-19", count: 0, current: true });
    expect(after.weeks.at(-2)).toEqual({ weekOf: "2026-10-12", count: 1, current: false });
  });

  it("sets the pace to the median of the last 8 complete weeks", async () => {
    const { tracker } = tracked();
    const mondays = ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"];
    for (const [i, n] of [4, 2, 4, 5, 4, 6, 3, 8].entries()) await addMany(tracker, n, mondays[i]!);
    await addMany(tracker, 9, "2026-10-12"); // this week doesn't count towards the pace

    expect((await tracker.stats()).pace).toBe(4);
  });

  it("gives a half when the middle two weeks differ", async () => {
    const { tracker } = tracked();
    const mondays = ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"];
    for (const [i, n] of [1, 1, 1, 3, 4, 6, 6, 6].entries()) await addMany(tracker, n, mondays[i]!);

    expect((await tracker.stats()).pace).toBe(3.5);
  });

  it("calls this week a win only when its count so far is above the pace", async () => {
    const { tracker } = tracked();
    for (const monday of ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"]) {
      await addMany(tracker, 2, monday);
    }
    await addMany(tracker, 2, "2026-10-12");
    expect((await tracker.stats()).thisWeek).toEqual({ count: 2, win: false });

    await add(tracker, "2026-10-12");
    expect((await tracker.stats()).thisWeek).toEqual({ count: 3, win: true });
  });

  it("is never a win without a pace to beat", async () => {
    const { tracker } = tracked();
    await add(tracker, "2026-10-12");

    expect(await tracker.stats()).toMatchObject({ pace: 0, thisWeek: { count: 1, win: false } });
  });
});
