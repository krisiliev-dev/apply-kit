// Interviews, thank-you notes, check-ins and the prep sheet (Track #33), at the tracker's public
// interface. Fake clock (starts Mon 12 Oct 2026, 10:30 in Sofia), in-memory database, a fake Track
// assistant answering with recorded outputs and a fake Master profile. Made-up people and companies.
import { describe, expect, it } from "vitest";
import { createTracker, type Status } from "../src/index.ts";
import { createTestEngine } from "./harness.ts";

const day = 24 * 60 * 60 * 1000;

function tracked() {
  const t = createTestEngine();
  const tracker = createTracker({ db: t.deps.db, clock: t.clock, discovery: t.engine });
  return { ...t, tracker };
}
type Tracker = ReturnType<typeof tracked>["tracker"];

async function add(
  tracker: Tracker,
  { company = "Medora", title = "Full-stack Engineer", appliedOn = "2026-09-28", status = "interviewing", contact }:
  { company?: string; title?: string; appliedOn?: string; status?: Exclude<Status, "accepted">; contact?: string } = {},
) {
  const r = await tracker.addByHand({ job: { company, title }, appliedOn, status, contact });
  if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
  return r.application.id;
}

const due = async (tracker: Tracker) =>
  (await tracker.needsYou()).items.filter((i) => !i.done).map((i) => `${i.application.company}:${i.followUp.kind}:${i.followUp.dueAt ?? i.followUp.dueOn}`);

describe("a thank-you note after an interview", () => {
  it("is ready when the interview ends and due exactly 24 hours after its start", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    await tracker.setInterview(id, {
      start: "2026-10-14T14:00", end: "2026-10-14T15:00", timeZone: "Europe/Sofia",
      format: "video", place: "Google Meet", people: ["Mara Ivanova"], round: "1 of 2", notes: null,
    });

    clock.set("2026-10-14T11:59:00Z"); // 14:59 in Sofia: still in the interview
    expect(await due(tracker)).toEqual([]);
    clock.set("2026-10-14T12:00:00Z"); // 15:00: it ended
    expect(await due(tracker)).toEqual(["Medora:thank-you:2026-10-15T11:00:00.000Z"]);
    const thanks = (await tracker.needsYou()).items[0]!.followUp;
    expect(thanks).toMatchObject({ readyAt: "2026-10-14T12:00:00.000Z", dueOn: "2026-10-15" });
  });

  it("isn't there for an interview without a time", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    await tracker.setInterview(id, { start: null, end: null, timeZone: "Europe/Sofia", format: "phone", place: null, people: [], round: null, notes: null });

    await clock.advance(10 * day);

    expect((await tracker.needsYou()).items.filter((i) => i.followUp.kind === "thank-you")).toEqual([]);
  });

  it("follows the interview when its time is corrected", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    const { interview } = await tracker.setInterview(id, { start: "2026-10-14T14:00", end: null, timeZone: "Europe/Sofia", format: "video", place: null, people: [], round: null, notes: null });

    await tracker.setInterview(id, { interviewId: interview.id, start: "2026-10-15T09:30", end: "2026-10-15T10:15", timeZone: "Europe/London", format: "video", place: null, people: [], round: null, notes: null });

    clock.set("2026-10-15T09:15:00Z");
    expect(await due(tracker)).toEqual(["Medora:thank-you:2026-10-16T08:30:00.000Z"]);
  });
});
