// Stats, at the tracker's public interface: applications per week with the pace, the response rate,
// interviews and what's working. Fake clock (Mon 12 Oct 2026, 10:30 in Sofia), in-memory database.
import { describe, expect, it } from "vitest";
import { createTracker, type Status } from "../src/index.ts";
import { createTestEngine, loadFixture } from "./harness.ts";
import { routedFetch } from "./http.ts";

function tracked(overrides: Parameters<typeof createTestEngine>[0] = {}) {
  const t = createTestEngine(overrides);
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

describe("response rate", () => {
  // Today is Mon 12 Oct 2026: Applications from 28 Sep or earlier are at least 14 days old.
  it("is replies over Applications at least 14 days old, saying how many newer ones are left out", async () => {
    const { tracker } = tracked();
    const replied = await add(tracker, "2026-09-20");
    await add(tracker, "2026-09-21");
    await add(tracker, "2026-09-28"); // exactly 14 days: counted
    await add(tracker, "2026-09-29"); // 13 days: left out
    const young = await add(tracker, "2026-10-05"); // left out, even with a reply
    await tracker.setStatus(replied, "screening");
    await tracker.setStatus(young, "interviewing");

    expect((await tracker.stats()).responseRate).toEqual({ replied: 1, counted: 3, excluded: 2, rate: 1 / 3, countsFrom: null });
  });

  it("counts a rejection as a reply, and a withdrawal alone as none", async () => {
    const { tracker } = tracked();
    const rejected = await add(tracker, "2026-09-01");
    const withdrawn = await add(tracker, "2026-09-01");
    await tracker.setStatus(rejected, "rejected");
    await tracker.setStatus(withdrawn, "withdrawn");

    expect((await tracker.stats()).responseRate).toMatchObject({ replied: 1, counted: 2 });
  });

  it("keeps a reply once the Status moves on, and drops one that was undone", async () => {
    const { tracker } = tracked();
    const movedOn = await add(tracker, "2026-09-01");
    await tracker.setStatus(movedOn, "screening");
    await tracker.setStatus(movedOn, "withdrawn");
    const slip = await add(tracker, "2026-09-01");
    const { event } = await tracker.setStatus(slip, "rejected");
    await tracker.undoEvent(event.id);

    expect((await tracker.stats()).responseRate).toMatchObject({ replied: 1, counted: 2 });
  });

  it("counts one added by hand already past Applied as replied", async () => {
    const { tracker } = tracked();
    await add(tracker, "2026-09-01", "rejected");
    await add(tracker, "2026-09-01", "applied");

    expect((await tracker.stats()).responseRate).toMatchObject({ replied: 1, counted: 2, rate: 0.5 });
  });

  it("has no rate yet while every Application is under 14 days old, and says when it starts counting", async () => {
    const { tracker } = tracked();
    await add(tracker, "2026-10-12");

    expect((await tracker.stats()).responseRate).toEqual({ replied: 0, counted: 0, excluded: 1, rate: null, countsFrom: "2026-10-26" });
  });
});

describe("what's working", () => {
  it("gives replied of sent per source, over Applications 14+ days old, \"too few\" under 5", async () => {
    const { tracker } = tracked();
    for (let i = 0; i < 5; i++) {
      const id = await add(tracker, "2026-09-01");
      if (i < 2) await tracker.setStatus(id, "rejected");
    }
    await add(tracker, "2026-10-09"); // too new to count

    expect((await tracker.stats()).working.source).toEqual([{ name: "Added by hand", replied: 2, sent: 5, tooFew: false }]);
  });

  it("says \"too few\" with 4 sent", async () => {
    const { tracker } = tracked();
    for (let i = 0; i < 4; i++) await add(tracker, "2026-09-01", i ? "applied" : "screening");

    expect((await tracker.stats()).working.source).toEqual([{ name: "Added by hand", replied: 1, sent: 4, tooFew: true }]);
  });

  it("groups by the Job's angle, leaving out Applications without one; no CV versions yet without Packages", async () => {
    const orbitlyJob = "https://careers.orbitly.example/jobs/4417-backend-engineer-go";
    const http = routedFetch((r) => (r.url === orbitlyJob ? new Response(loadFixture("page-orbitly-backend.html"), { headers: { "content-type": "text/html" } }) : undefined));
    const { tracker } = tracked({ fetch: http.fetch });
    await tracker.addByHand({ job: { company: "Orbitly", title: "Backend Engineer", link: orbitlyJob }, appliedOn: "2026-09-01", status: "interviewing" });
    await add(tracker, "2026-09-01");

    const { working } = await tracker.stats();

    expect(working.angle).toEqual([{ name: "Developer", replied: 1, sent: 1, tooFew: true }]);
    expect(working.cvVersion).toEqual([]);
    expect(working.source.map((r) => [r.name, r.sent])).toEqual([["Added by hand", 1], ["Pasted link", 1]]);
  });
});

describe("interviews", () => {
  // Interview records come with #33; until then an interview is an Application that reached Interviewing.
  it("counts Applications that reached Interviewing so far, and at how many companies", async () => {
    const { tracker } = tracked();
    const a = await add(tracker, "2026-09-01", "applied", "Fennel Studio");
    await tracker.setStatus(a, "interviewing");
    await tracker.setStatus(a, "rejected");
    await add(tracker, "2026-09-02", "offer", "Fennel Studio");
    await add(tracker, "2026-09-03", "interviewing", "Orbitly");
    await add(tracker, "2026-09-04", "screening", "Tidewater Pay");
    const slip = await add(tracker, "2026-09-05", "applied", "Ardent Labs");
    const { event } = await tracker.setStatus(slip, "interviewing");
    await tracker.undoEvent(event.id);

    expect((await tracker.stats()).interviews).toEqual({ upcoming: 0, soFar: 3, companies: 2 });
  });
});

describe("the strip's headline", () => {
  it("names the total, the first date applied, and last week when it was the best week yet", async () => {
    const { tracker } = tracked();
    await addMany(tracker, 2, "2026-08-20");
    await addMany(tracker, 3, "2026-10-06");
    await add(tracker, "2026-10-12");

    expect(await tracker.stats()).toMatchObject({ total: 6, since: "2026-08-20", lastWeek: { count: 3, best: true } });
  });

  it("isn't the best week yet when an earlier week matched it, nor when it is the first", async () => {
    const { tracker } = tracked();
    await addMany(tracker, 3, "2026-06-01"); // before the chart's 9 weeks: still counts
    await addMany(tracker, 3, "2026-10-06");
    expect((await tracker.stats()).lastWeek).toEqual({ count: 3, best: false });

    const fresh = tracked();
    await add(fresh.tracker, "2026-10-06");
    expect((await fresh.tracker.stats()).lastWeek).toEqual({ count: 1, best: false });
  });
});
