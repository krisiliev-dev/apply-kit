// One Application, as its page shows it, at the tracker's public interface: the status stepper
// derived from Events, the next step, the timeline with each Event's cause, notes, contacts, the
// target posting (and its closing, from Discover) and the CV attached to one added by hand.
// Fake clock, in-memory database, no network.
import { describe, expect, it } from "vitest";
import { createTracker, type Status } from "../src/index.ts";
import { createTestEngine, fixtureFetch } from "./harness.ts";

function tracked(overrides: Parameters<typeof createTestEngine>[0] = {}) {
  const t = createTestEngine(overrides);
  const tracker = createTracker({ db: t.deps.db, clock: t.clock, discovery: t.engine });
  return { ...t, tracker };
}

type Tracker = ReturnType<typeof tracked>["tracker"];

/** Adds an Application made elsewhere (Fennel Studio) and returns its id. */
async function add(tracker: Tracker, status: Exclude<Status, "accepted"> = "applied", contact?: string) {
  const r = await tracker.addByHand({ job: { company: "Fennel Studio", title: "UX Engineer" }, appliedOn: "2026-10-09", status, contact });
  if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
  return r.application.id;
}

const stepStates = async (tracker: Tracker, id: string) =>
  (await tracker.get(id))!.steps.map((s) => `${s.status}:${s.state}`);

describe("the status stepper", () => {
  it("marks steps done, current and still to come for a fresh Application", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);

    expect(await stepStates(tracker, id)).toEqual(["applied:current", "screening:todo", "interviewing:todo", "offer:todo", "accepted:todo"]);
  });

  it("marks Screening skipped when it went Applied → Interviewing", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);

    await tracker.setStatus(id, "interviewing");

    expect(await stepStates(tracker, id)).toEqual(["applied:done", "screening:skipped", "interviewing:current", "offer:todo", "accepted:todo"]);
  });

  it("keeps what happened before a rejection, and forgets an undone change", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);
    const slip = await tracker.setStatus(id, "offer");
    await tracker.undoEvent(slip.event.id);
    await tracker.setStatus(id, "interviewing");
    await tracker.setStatus(id, "rejected");

    expect(await stepStates(tracker, id)).toEqual(["applied:done", "screening:skipped", "interviewing:done", "offer:todo", "accepted:todo"]);
  });
});

describe("notes and the next step", () => {
  it("says to wait for a reply until there's a note", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);

    expect((await tracker.get(id))!.nextStep).toEqual({ kind: "wait", text: "Wait for a reply." });
  });

  it("adds a note to the timeline, by you, newest first, and the latest note becomes the next step", async () => {
    const { tracker, clock } = tracked();
    const id = await add(tracker);
    await clock.advance(60_000);
    await tracker.addNote(id, "  Recruiter called: second round next week.  ");
    await clock.advance(60_000);

    const { event } = await tracker.addNote(id, "Ask about the on-call rota.");

    expect(event).toMatchObject({ kind: "note", cause: "you", text: "Ask about the on-call rota." });
    const app = (await tracker.get(id))!;
    expect(app.timeline.map((e) => [e.kind, e.cause, e.text])).toEqual([
      ["note", "you", "Ask about the on-call rota."],
      ["note", "you", "Recruiter called: second round next week."],
      ["created", "you", "Added by hand"],
    ]);
    expect(app.nextStep).toEqual({ kind: "note", text: "Ask about the on-call rota.", at: event.at });
    expect(app.status).toBe("applied");
  });

  it("refuses an empty note", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);

    await expect(tracker.addNote(id, "   ")).rejects.toMatchObject({ problem: "invalid" });
  });

  it("lets a Status change be undone after a note was added since", async () => {
    const { tracker } = tracked();
    const id = await add(tracker);
    const { event } = await tracker.setStatus(id, "screening");
    await tracker.addNote(id, "They want a portfolio link.");

    const app = (await tracker.get(id))!;
    expect(app.timeline.find((e) => e.id === event.id)).toMatchObject({ undoable: true });
    await tracker.undoEvent(event.id);
    expect((await tracker.get(id))!.status).toBe("applied");
  });
});

describe("contacts", () => {
  it("lists the domain given when adding, and an address added later, whose mail is matched here", async () => {
    const { tracker } = tracked();
    const id = await add(tracker, "applied", "fennel.studio");

    const { contacts } = await tracker.addContact(id, " Mira.Petrova@Example.com ");

    expect(contacts).toEqual([
      { value: "fennel.studio", kind: "domain" },
      { value: "mira.petrova@example.com", kind: "address" },
    ]);
    expect((await tracker.get(id))!.contacts).toEqual(contacts);
  });

  it("refuses something that is neither an address nor a domain, and one already there", async () => {
    const { tracker } = tracked();
    const id = await add(tracker, "applied", "fennel.studio");

    await expect(tracker.addContact(id, "Mira from Fennel")).rejects.toMatchObject({ problem: "invalid" });
    await expect(tracker.addContact(id, "https://www.fennel.studio/careers")).rejects.toMatchObject({ problem: "unchanged" });
    expect((await tracker.get(id))!.contacts).toHaveLength(1);
  });
});
