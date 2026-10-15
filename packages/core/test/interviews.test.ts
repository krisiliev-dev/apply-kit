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

const at = (start: string, end: string | null = null, timeZone = "Europe/Sofia") =>
  ({ start, end, timeZone, format: "video" as const, place: null, people: ["Mara Ivanova"], round: null, notes: null });

describe("a check-in when interviews go quiet", () => {
  it("comes due 7 days after the last interview ends with no news, and not before", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    await tracker.setInterview(id, at("2026-10-13T10:00", "2026-10-13T11:00"));
    await tracker.setInterview(id, at("2026-10-15T14:00", "2026-10-15T15:00"));
    const checkIns = async () => (await due(tracker)).filter((d) => d.includes("check-in"));

    clock.set("2026-10-21T21:00:00Z"); // Thu 22 Oct, 00:00 in Sofia: 6 quiet days
    expect(await checkIns()).toEqual(["Medora:check-in:2026-10-22"]);
    clock.set("2026-10-21T20:59:00Z");
    expect(await checkIns()).toEqual([]);
  });

  it("isn't there while an interview is still to come, nor after a reply or a Status change", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    await tracker.setInterview(id, at("2026-10-13T10:00", "2026-10-13T11:00"));
    await tracker.setInterview(id, at("2026-10-27T10:00", "2026-10-27T11:00"));
    clock.set("2026-10-24T08:00:00Z");
    expect((await due(tracker)).filter((d) => d.includes("check-in"))).toEqual([]);

    const other = await add(tracker, { company: "Ostwind Cloud" });
    await tracker.setInterview(other, at("2026-10-14T10:00", "2026-10-14T11:00"));
    expect((await due(tracker)).filter((d) => d.includes("check-in"))).toEqual(["Ostwind Cloud:check-in:2026-10-21"]);
    await tracker.setStatus(other, "offer");
    expect((await due(tracker)).filter((d) => d.includes("check-in"))).toEqual([]);
  });

  it("follows the check-in delay setting", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    await tracker.setInterview(id, at("2026-10-13T10:00", "2026-10-13T11:00"));
    await tracker.saveFollowUpSettings({ checkInAfterDays: 4 });

    clock.set("2026-10-17T08:00:00Z");
    expect((await due(tracker)).filter((d) => d.includes("check-in"))).toEqual(["Medora:check-in:2026-10-17"]);
  });
});

describe("the interview as a calendar file (.ics)", () => {
  /** The .ics with folded lines joined again, one property per line. */
  const unfold = (text: string) => text.replace(/\r\n /g, "").split("\r\n");

  it("keeps the interview's own time zone and its details", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);
    const { interview } = await tracker.setInterview(id, {
      start: "2026-10-20T14:00", end: "2026-10-20T15:00", timeZone: "Europe/London", format: "video", place: "Google Meet",
      people: ["Mara Ivanova, Engineering Manager", "Teo Lindqvist"], round: "1 of 2", notes: "Teo is in Stockholm; bring the take-home questions.",
    });

    const ics = (await tracker.interviewIcs(interview.id))!;

    expect(ics.fileName).toBe("interview-medora-2026-10-20.ics");
    const lines = unfold(ics.text);
    expect(lines).toEqual(expect.arrayContaining([
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "END:VEVENT", "END:VCALENDAR",
      "TZID:Europe/London", "TZOFFSETTO:+0100",
      "DTSTART;TZID=Europe/London:20261020T140000",
      "DTEND;TZID=Europe/London:20261020T150000",
      "SUMMARY:Interview: Full-stack Engineer at Medora (1 of 2)",
      "LOCATION:Google Meet",
      "DESCRIPTION:Round: 1 of 2\\nFormat: Video call\\nWith: Mara Ivanova\\, Engineering Manager\\; Teo Lindqvist\\nNotes: Teo is in Stockholm\\; bring the take-home questions.",
    ]));
    expect(ics.text.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it("uses the offset of the day itself (Sofia after the clocks go back), an hour when no end is given, and isn't there without a time", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);
    const { interview } = await tracker.setInterview(id, at("2026-11-02T10:00"));
    const lines = unfold((await tracker.interviewIcs(interview.id))!.text);
    expect(lines).toEqual(expect.arrayContaining(["TZOFFSETTO:+0200", "DTSTART;TZID=Europe/Sofia:20261102T100000", "DTEND;TZID=Europe/Sofia:20261102T110000"]));

    const { interview: none } = await tracker.setInterview(id, { ...at("2026-11-02T10:00"), start: null });
    expect(await tracker.interviewIcs(none.id)).toBeNull();
  });
});
