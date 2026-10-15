// Offers and closing (Track #34), at the tracker's public interface: accepting an offer (from the
// Offer page or Accepted in any Status select) moves it to Accepted and offers a withdrawal for every
// other open Application, each moving to Withdrawn only when marked sent (or kept open); declining
// moves it to Withdrawn with the reason "declined offer"; offer details pre-filled from the offer
// email and compared with the salary floor; a rejection's optional lesson and likely reason. Fake
// clock (Mon 12 Oct 2026, 10:30 in Sofia), in-memory database, a fake Track assistant answering with
// recorded drafts, no live AI and no mailbox.
import { describe, expect, it } from "vitest";
import { createTracker, type DraftInput, type Status, type TrackAssistant, type Tracker } from "../src/index.ts";
import { createTestEngine } from "./harness.ts";

const withdrawalBody = "Thank you for the time your team has given me. I've accepted another offer, so I'd like to withdraw from the process. I enjoyed our conversations and hope our paths cross again.";

/** The fake Track assistant: answers each draft with a recorded body, and records what it was sent. */
function fakeAssistant({ body = withdrawalBody }: { body?: string | ((i: DraftInput) => string) } = {}) {
  const inputs: DraftInput[] = [];
  const assistant: TrackAssistant = {
    estimateClassifyUsd: () => 0.0005,
    classify: async () => { throw new Error("not in these tests"); },
    estimateDraftUsd: () => 0.002,
    async draft(input) {
      inputs.push(input);
      return { draft: { body: typeof body === "function" ? body(input) : body }, costUsd: 0.002, model: "fake/track-assistant" };
    },
  };
  return { assistant, inputs };
}

function setup({ ai = fakeAssistant() }: { ai?: ReturnType<typeof fakeAssistant> } = {}) {
  const t = createTestEngine({ aiMonthlyCapUsd: 10 });
  const tracker = createTracker({ db: t.deps.db, clock: t.clock, discovery: t.engine, assistant: ai.assistant, aiMonthlyCapUsd: 10 });
  const add = async (company: string, title: string, status: Exclude<Status, "accepted"> = "applied", { appliedOn = "2026-10-01", contact }: { appliedOn?: string; contact?: string } = {}) => {
    const r = await tracker.addByHand({ job: { company, title }, appliedOn, status, contact });
    if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
    return r.application.id;
  };
  return { ...t, tracker, ai, add };
}

/** Ardent Labs' offer, and four other Applications: two open, one rejected, one withdrawn. */
async function withOffer() {
  const s = setup();
  const ardent = await s.add("Ardent Labs", "Detection Engineer", "offer", { contact: "lea.hristova@ardentlabs.example" });
  const medora = await s.add("Medora", "Full-stack Engineer", "interviewing", { contact: "mara@medora.example" });
  const velta = await s.add("Velta Logistics", "Platform Engineer", "applied", { contact: "jobs@velta.example" });
  const pixelmoor = await s.add("Pixelmoor", "UI Designer", "rejected");
  const gridline = await s.add("Gridline Analytics", "Frontend Developer", "withdrawn");
  return { ...s, ardent, medora, velta, pixelmoor, gridline };
}

const statusOf = async (tracker: Tracker, id: string) => (await tracker.get(id))!.status;
const companies = (ws: { application: { company: string } }[]) => ws.map((w) => w.application.company).sort();

describe("accepting an offer", () => {
  it("moves it to Accepted, by you, and offers a withdrawal for every other open Application", async () => {
    const { tracker, ardent, velta } = await withOffer();

    const r = await tracker.acceptOffer(ardent);

    expect(r.application.status).toBe("accepted");
    expect(r.event).toMatchObject({ kind: "status", cause: "you", from: "offer", to: "accepted" });
    expect(companies(r.withdrawals)).toEqual(["Medora", "Velta Logistics"]);
    expect(r.withdrawals.every((w) => w.followUp.kind === "withdrawal" && w.followUp.state === "pending")).toBe(true);
    // Offering a withdrawal changes nothing yet.
    expect(await statusOf(tracker, velta)).toBe("applied");
  });
});

describe("a withdrawal", () => {
  it("moves its Application to Withdrawn only when marked sent, by you; undo brings both back", async () => {
    const { tracker, ardent, velta } = await withOffer();
    const { withdrawals } = await tracker.acceptOffer(ardent);
    const w = withdrawals.find((x) => x.application.id === velta)!;

    const sent = await tracker.markFollowUpSent(w.followUp.id);

    expect(sent.followUp.state).toBe("sent");
    expect(sent.event).toMatchObject({ kind: "status", cause: "you", from: "applied", to: "withdrawn", reason: "accepted another offer" });
    expect(await statusOf(tracker, velta)).toBe("withdrawn");
    // Sent ones stay in the list, shown as done.
    expect((await tracker.withdrawals()).items.find((x) => x.application.id === velta)!.followUp.state).toBe("sent");

    await tracker.undoEvent(sent.event.id);

    expect(await statusOf(tracker, velta)).toBe("applied");
    expect((await tracker.withdrawals()).items.find((x) => x.application.id === velta)!.followUp.state).toBe("pending");
  });

  it("kept open leaves the list, changes nothing, and is undoable", async () => {
    const { tracker, ardent, medora } = await withOffer();
    const { withdrawals } = await tracker.acceptOffer(ardent);
    const w = withdrawals.find((x) => x.application.id === medora)!;

    const kept = await tracker.skipFollowUp(w.followUp.id);

    expect(kept.event).toMatchObject({ kind: "follow-up-skipped", cause: "you", text: "Kept open: no withdrawal" });
    expect(companies((await tracker.withdrawals()).items)).toEqual(["Velta Logistics"]);
    expect(await statusOf(tracker, medora)).toBe("interviewing");

    await tracker.undoEvent(kept.event.id);

    expect(companies((await tracker.withdrawals()).items)).toEqual(["Medora", "Velta Logistics"]);
  });

  it("waits in Needs you as a withdrawal to send until marked sent or kept open", async () => {
    const { tracker, ardent, velta } = await withOffer();
    const { withdrawals } = await tracker.acceptOffer(ardent);

    const before = await tracker.needsYou();
    expect(before.items.filter((i) => !i.done).map((i) => `${i.application.company}:${i.followUp.kind}`).sort())
      .toEqual(["Medora:withdrawal", "Velta Logistics:withdrawal"]);
    expect(before.count).toBe(2);

    await tracker.markFollowUpSent(withdrawals.find((x) => x.application.id === velta)!.followUp.id);

    const after = await tracker.needsYou();
    expect(after.count).toBe(1);
    expect(after.items.find((i) => i.application.id === velta)).toMatchObject({ done: true, followUp: { state: "sent" } });
  });

  it("goes when the accept is undone: back to Offer, nothing left to withdraw", async () => {
    const { tracker, ardent } = await withOffer();
    const { event } = await tracker.acceptOffer(ardent);

    await tracker.undoEvent(event.id);

    expect(await statusOf(tracker, ardent)).toBe("offer");
    expect((await tracker.withdrawals()).items).toEqual([]);
    expect((await tracker.needsYou()).items.filter((i) => i.followUp.kind === "withdrawal")).toEqual([]);
  });
});
