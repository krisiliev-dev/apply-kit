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
