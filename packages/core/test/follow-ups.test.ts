// Follow-ups and Needs you, at the tracker's public interface: nudges that come due on their own
// (one per stage), the offer note to self, cancellation by a Status change (and its undo), snooze,
// skip and Mark sent, the outline with no model call, and the delays as settings.
// Fake clock (Mon 12 Oct 2026, 10:30 in Sofia), in-memory database, no network.
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

/** Adds an Application made elsewhere and returns its id. */
async function add(
  tracker: Tracker,
  { company = "Fennel Studio", title = "UX Engineer", appliedOn = "2026-10-09", status = "applied", contact }:
  { company?: string; title?: string; appliedOn?: string; status?: Exclude<Status, "accepted">; contact?: string } = {},
) {
  const r = await tracker.addByHand({ job: { company, title }, appliedOn, status, contact });
  if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
  return r.application.id;
}

const due = async (tracker: Tracker) =>
  (await tracker.needsYou()).items.filter((i) => !i.done).map((i) => `${i.application.company}:${i.followUp.kind}:${i.followUp.dueOn}`);

describe("a nudge after applying", () => {
  it("comes due 7 days after the date applied, and not before", async () => {
    const { tracker, clock } = tracked();
    await add(tracker, { appliedOn: "2026-10-09" });

    expect(await due(tracker)).toEqual([]);
    await clock.advance(4 * day); // Fri 16 Oct

    expect(await due(tracker)).toEqual(["Fennel Studio:nudge:2026-10-16"]);
    expect((await tracker.needsYou()).count).toBe(1);
  });
});

describe("one nudge per stage", () => {
  it("gives Screening its own nudge, 7 days after the move, and never a second one in a stage", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker, { appliedOn: "2026-10-05" });
    const first = (await tracker.needsYou()).items[0]!.followUp;
    await tracker.markFollowUpSent(first.id);

    await clock.advance(30 * day);
    expect(await due(tracker)).toEqual([]);

    await tracker.setStatus(id, "screening"); // Wed 11 Nov
    await clock.advance(7 * day);
    expect(await due(tracker)).toEqual(["Fennel Studio:nudge:2026-11-18"]);
    await tracker.skipFollowUp((await tracker.needsYou()).items[0]!.followUp.id);

    // Back to Applied and on to Screening again: both stages had theirs.
    await tracker.setStatus(id, "applied");
    await tracker.setStatus(id, "screening");
    await clock.advance(20 * day);
    expect(await due(tracker)).toEqual([]);
  });

  it("has none while Interviewing, after Accepted or once closed", async () => {
    const { tracker, clock } = tracked();
    await add(tracker, { company: "Medora", status: "interviewing" });
    await add(tracker, { company: "Pixelmoor", status: "rejected" });
    await clock.advance(30 * day);

    expect(await due(tracker)).toEqual([]);
  });
});

describe("a note to self after an Offer", () => {
  it("comes due the day after the Offer", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker, { company: "Ardent Labs" });
    await tracker.setStatus(id, "offer"); // Mon 12 Oct

    expect(await due(tracker)).toEqual([]);
    await clock.advance(day);
    expect(await due(tracker)).toEqual(["Ardent Labs:offer-note:2026-10-13"]);
  });
});

describe("a Status change", () => {
  it("cancels the pending nudge, and says so", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker, { appliedOn: "2026-10-01" });
    expect(await due(tracker)).toEqual(["Fennel Studio:nudge:2026-10-08"]);

    const { cancelled } = await tracker.setStatus(id, "rejected");

    expect(cancelled).toMatchObject({ kind: "nudge", dueOn: "2026-10-08", state: "pending" });
    await clock.advance(10 * day);
    expect(await due(tracker)).toEqual([]);
  });

  it("brings the follow-up it cancelled back when undone, as it was: snoozed, with its typed text", async () => {
    const { tracker } = tracked();
    const id = await add(tracker, { appliedOn: "2026-10-01" });
    const nudge = (await tracker.needsYou()).items[0]!.followUp;
    await tracker.saveFollowUpText(nudge.id, "Still keen on the role.");
    await tracker.snoozeFollowUp(nudge.id); // to Thu 15 Oct
    const { event } = await tracker.setStatus(id, "screening");
    expect((await tracker.get(id))!.followUp).toMatchObject({ kind: "nudge", anchorOn: "2026-10-12", dueOn: "2026-10-19", text: "" });

    await tracker.undoEvent(event.id);

    expect((await tracker.get(id))!.followUp).toEqual({
      id: nudge.id, applicationId: id, kind: "nudge", anchorOn: "2026-10-01", dueOn: "2026-10-15", snoozedTo: "2026-10-15",
      state: "pending", doneAt: null, doneBy: null, text: "Still keen on the role.", interviewId: null, dueAt: null, readyAt: null, topic: "",
    });
  });
});

describe("snooze, skip and Mark sent", () => {
  it("snooze moves it 3 days on from today, logged by you; undo puts it back to due", async () => {
    const { tracker, clock } = tracked();
    await add(tracker, { appliedOn: "2026-10-01" });
    const nudge = (await tracker.needsYou()).items[0]!.followUp;

    const { followUp, event } = await tracker.snoozeFollowUp(nudge.id);

    expect(followUp).toMatchObject({ dueOn: "2026-10-15", state: "pending" });
    expect(event).toMatchObject({ kind: "follow-up-snoozed", cause: "you", text: "Follow-up snoozed to Thu 15 Oct" });
    expect(await due(tracker)).toEqual([]);
    expect((await tracker.needsYou()).comingUp).toEqual([expect.objectContaining({ company: "Fennel Studio", kind: "nudge", dueOn: "2026-10-15" })]);
    await clock.advance(3 * day);
    expect(await due(tracker)).toEqual(["Fennel Studio:nudge:2026-10-15"]);

    await tracker.undoEvent(event.id);
    expect(await due(tracker)).toEqual(["Fennel Studio:nudge:2026-10-08"]);
  });

  it("Mark sent logs an Event by you and stops it; the item stays today, shown as done; undo makes it due again", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker, { appliedOn: "2026-10-01" });
    const nudge = (await tracker.needsYou()).items[0]!.followUp;

    const { event } = await tracker.markFollowUpSent(nudge.id);

    expect(event).toMatchObject({ kind: "follow-up-sent", cause: "you", text: "Follow-up sent", followUpId: nudge.id });
    expect((await tracker.get(id))!.timeline[0]).toMatchObject({ text: "Follow-up sent", cause: "you", undoable: true });
    const after = await tracker.needsYou();
    expect(after.count).toBe(0);
    expect(after.items).toEqual([expect.objectContaining({ done: true, followUp: expect.objectContaining({ state: "sent" }) })]);
    await expect(tracker.markFollowUpSent(nudge.id)).rejects.toMatchObject({ problem: "unchanged" });

    await tracker.undoEvent(event.id);
    expect(await due(tracker)).toEqual(["Fennel Studio:nudge:2026-10-08"]);

    await tracker.markFollowUpSent(nudge.id);
    await clock.advance(day);
    expect((await tracker.needsYou()).items).toEqual([]);
  });

  it("skip (no note this time) closes it without sending; undoable", async () => {
    const { tracker } = tracked();
    await add(tracker, { appliedOn: "2026-10-01" });
    const nudge = (await tracker.needsYou()).items[0]!.followUp;

    const { followUp, event } = await tracker.skipFollowUp(nudge.id);

    expect(followUp.state).toBe("skipped");
    expect(event).toMatchObject({ kind: "follow-up-skipped", text: "No follow-up this time" });
    expect((await tracker.needsYou()).count).toBe(0);
    await tracker.undoEvent(event.id);
    expect((await tracker.needsYou()).count).toBe(1);
  });

  it("refuses acting on a follow-up whose stage has been left, and undoing one once the Status moved since", async () => {
    const { tracker } = tracked();
    const id = await add(tracker, { appliedOn: "2026-10-01" });
    const nudge = (await tracker.needsYou()).items[0]!.followUp;
    const { event } = await tracker.markFollowUpSent(nudge.id);
    await tracker.setStatus(id, "screening");

    await expect(tracker.undoEvent(event.id)).rejects.toMatchObject({ problem: "changed-since" });
    const other = await add(tracker, { company: "Lumio Maps", appliedOn: "2026-10-01" });
    const lumio = (await tracker.needsYou()).items.find((i) => i.application.id === other)!.followUp;
    await tracker.setStatus(other, "interviewing");
    await expect(tracker.snoozeFollowUp(lumio.id)).rejects.toMatchObject({ problem: "changed-since" });
  });
});

describe("Needs you", () => {
  it("lists due items most urgent first, and things only coming up (next 3 days) as one line, soonest first", async () => {
    const { tracker } = tracked();
    await add(tracker, { company: "Velta Logistics", appliedOn: "2026-10-04" });
    await add(tracker, { company: "Tidewater Pay", appliedOn: "2026-09-30" });
    await add(tracker, { company: "Lumio Maps", appliedOn: "2026-10-08" });
    await add(tracker, { company: "Ardent Labs", appliedOn: "2026-10-06" });
    await add(tracker, { company: "Fennel Studio", appliedOn: "2026-10-09" });

    const n = await tracker.needsYou();

    expect(n.count).toBe(2);
    expect(n.items.map((i) => `${i.application.company} ${i.followUp.dueOn}`)).toEqual(["Tidewater Pay 2026-10-07", "Velta Logistics 2026-10-11"]);
    expect(n.comingUp.map((c) => `${c.company} ${c.dueOn}`)).toEqual(["Ardent Labs 2026-10-13", "Lumio Maps 2026-10-15"]);
  });
});

describe("the list's Next column", () => {
  it("names the follow-up and its day, says when it's due, and after a nudge is sent says how long it's been quiet", async () => {
    const { tracker, clock } = tracked();
    const fennel = await add(tracker, { appliedOn: "2026-10-09" });
    const tide = await add(tracker, { company: "Tidewater Pay", appliedOn: "2026-10-05" });
    const medora = await add(tracker, { company: "Medora", status: "interviewing" });
    const next = async (id: string) => (await tracker.get(id))!.next;

    expect(await next(fennel)).toEqual({ kind: "follow-up", followUpKind: "nudge", dueOn: "2026-10-16", due: false });
    expect(await next(tide)).toEqual({ kind: "follow-up", followUpKind: "nudge", dueOn: "2026-10-12", due: true });
    expect(await next(medora)).toBeNull();

    await tracker.markFollowUpSent((await tracker.get(tide))!.followUp!.id);
    await clock.advance(2 * day);
    expect(await next(tide)).toEqual({ kind: "no-reply", days: 9 });
    const applied = (await tracker.list()).groups.find((g) => g.key === "applied")!;
    expect(applied.applications.map((a) => a.next?.kind)).toEqual(["no-reply", "follow-up"]);
  });
});

describe("writing a follow-up", () => {
  it("gives an outline from the Application with no model call, and Open in Mail's recipient and subject", async () => {
    const { tracker } = tracked();
    const id = await add(tracker, { company: "Tidewater Pay", title: "Application Security Engineer", appliedOn: "2026-10-05", contact: "careers@tidewaterpay.example" });
    await tracker.addNote(id, "They use Go for the payment services.");
    const nudge = (await tracker.get(id))!.followUp!;

    const draft = (await tracker.followUp(nudge.id))!;

    expect(draft.outline).toEqual([
      "Applied for Application Security Engineer on Mon 5 Oct; still interested.",
      "From your notes: \"They use Go for the payment services.\".",
      "One true example of your own that fits it; numbers only from your Master profile.",
      "Offer a call; no pressure.",
    ]);
    expect(draft.mail).toEqual({ to: "careers@tidewaterpay.example", subject: "Following up on my application: Application Security Engineer" });
    expect(draft.words).toEqual({ min: 70, max: 110 });
    expect(draft.snoozeDays).toBe(3);
  });

  it("has no recipient when only the company's domain is known, and no mail at all for a note to self", async () => {
    const { tracker } = tracked();
    const id = await add(tracker, { appliedOn: "2026-10-01", contact: "fennel.example" });
    expect((await tracker.followUp((await tracker.get(id))!.followUp!.id))!.mail).toMatchObject({ to: null });

    await tracker.setStatus(id, "offer");
    const note = (await tracker.followUp((await tracker.get(id))!.followUp!.id))!;
    expect(note.followUp.kind).toBe("offer-note");
    expect(note.mail).toBeNull();
    expect(note.outline[0]).toBe("The offer from Fennel Studio for UX Engineer came Mon 12 Oct. When do they need your answer?");
  });

  it("keeps the text as typed, across a new tracker on the same database", async () => {
    const t = tracked();
    const id = await add(t.tracker, { appliedOn: "2026-10-01" });
    const nudge = (await t.tracker.get(id))!.followUp!;

    await t.tracker.saveFollowUpText(nudge.id, "Hi Mira,\n\nI applied on 1 October…");
    const again = createTracker({ db: t.deps.db, clock: t.clock, discovery: t.engine });

    expect((await again.followUp(nudge.id))!.followUp.text).toBe("Hi Mira,\n\nI applied on 1 October…");
  });
});

describe("follow-up delays as settings", () => {
  it("start at 7 days for a nudge, 1 day for the note to self, 3 days of snooze and 7 days for a check-in", async () => {
    const { tracker } = tracked();
    expect(await tracker.followUpSettings()).toEqual({ nudgeAfterDays: 7, offerNoteAfterDays: 1, snoozeDays: 3, checkInAfterDays: 7 });
  });

  it("move pending follow-ups when changed, and refuse what isn't a number of days", async () => {
    const { tracker } = tracked();
    await add(tracker, { appliedOn: "2026-10-09" });

    await tracker.saveFollowUpSettings({ nudgeAfterDays: 3, offerNoteAfterDays: 2, snoozeDays: 5 });

    expect(await due(tracker)).toEqual(["Fennel Studio:nudge:2026-10-12"]);
    expect(await tracker.followUpSettings()).toEqual({ nudgeAfterDays: 3, offerNoteAfterDays: 2, snoozeDays: 5, checkInAfterDays: 7 });
    await expect(tracker.saveFollowUpSettings({ nudgeAfterDays: 0 })).rejects.toThrow("The follow-up delay must be a whole number of days from 1 to 60.");
  });
});

describe("at volume", () => {
  it("groups same-kind follow-ups due once there are 3 or more, most urgent first; fewer stay one by one", async () => {
    const { tracker } = tracked();
    for (const [company, appliedOn] of [["Lumio Maps", "2026-10-03"], ["Tidewater Pay", "2026-10-01"]] as const) {
      await add(tracker, { company, appliedOn });
    }
    expect((await tracker.needsYou()).groups).toEqual([]);
    await add(tracker, { company: "Velta Logistics", appliedOn: "2026-10-02" });
    expect((await tracker.needsYou()).groups[0]).toMatchObject({ count: 3 });

    const medora = await add(tracker, { company: "Medora", appliedOn: "2026-10-05" });
    const needs = await tracker.needsYou();

    expect(needs.groups).toEqual([{
      kind: "nudge", count: 4, done: 0, oldestDueOn: "2026-10-08",
      companies: ["Tidewater Pay", "Velta Logistics", "Lumio Maps", "Medora"],
      followUpIds: needs.items.map((i) => i.followUp.id),
    }]);
    expect(needs.count).toBe(4);

    // One done today stays out of the count and the drafts to step through; the group stays for the day.
    await tracker.markFollowUpSent((await tracker.get(medora))!.followUp!.id);
    expect((await tracker.needsYou()).groups[0]).toMatchObject({ count: 3, done: 1, companies: ["Tidewater Pay", "Velta Logistics", "Lumio Maps"] });
  });
});
