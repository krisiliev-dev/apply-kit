// Offers and closing (Track #34), at the tracker's public interface: accepting an offer (from the
// Offer page or Accepted in any Status select) moves it to Accepted and offers a withdrawal for every
// other open Application, each moving to Withdrawn only when marked sent (or kept open); declining
// moves it to Withdrawn with the reason "declined offer"; offer details pre-filled from the offer
// email and compared with the salary floor; a rejection's optional lesson and likely reason. Fake
// clock (Mon 12 Oct 2026, 10:30 in Sofia), in-memory database, a fake Track assistant answering with
// recorded drafts, no live AI and no mailbox.
import { describe, expect, it } from "vitest";
import {
  createTracker, defaultSearchSettings, type DraftInput, type EmailClassification, type Status, type TrackAssistant, type Tracker,
} from "../src/index.ts";
import { createTestEngine, fakeClock, fakeMailbox, mailMessage } from "./harness.ts";

const withdrawalBody = "Thank you for the time your team has given me. I've accepted another offer, so I'd like to withdraw from the process. I enjoyed our conversations and hope our paths cross again.";

/** The fake Track assistant: answers each draft with a recorded body, and records what it was sent. */
function fakeAssistant({ body = withdrawalBody }: { body?: string | ((i: DraftInput) => string) } = {}) {
  const inputs: DraftInput[] = [];
  const assistant: TrackAssistant = {
    estimateClassifyUsd: () => 0.0005,
    classify: async () => { throw new Error("not in these tests"); },
    estimateDraftUsd: () => 0.002,
    estimatePrepSheetUsd: () => 0.002,
    buildPrepSheet: async () => { throw new Error("not in these tests"); },
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

  it("is the only way to Accepted: from any Status (Accepted in a list select), never a silent Status change", async () => {
    const { tracker, velta, medora } = await withOffer();

    await expect(tracker.setStatus(velta, "accepted")).rejects.toMatchObject({ problem: "accepted" });
    const r = await tracker.acceptOffer(medora);

    expect(r.event).toMatchObject({ from: "interviewing", to: "accepted" });
    expect(companies(r.withdrawals)).toEqual(["Ardent Labs", "Velta Logistics"]);
    await expect(tracker.acceptOffer(medora)).rejects.toMatchObject({ problem: "unchanged" });
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

describe("a withdrawal's draft", () => {
  it("comes from the Track assistant in the posting's language, with Open in Mail's recipient and subject", async () => {
    const ai = fakeAssistant({ body: (i) => (i.language === "bg" ? "Благодаря Ви за отделеното време. Приех друго предложение и оттеглям кандидатурата си. Пожелавам Ви успех." : withdrawalBody) });
    const s = setup({ ai });
    const ardent = await s.add("Ardent Labs", "Detection Engineer", "offer");
    await s.add("Varna Trust Bank", "Специалист информационна сигурност", "screening", { contact: "careers@varnatrust.example" });
    const { withdrawals } = await s.tracker.acceptOffer(ardent);

    const d = (await s.tracker.followUp(withdrawals[0]!.followUp.id))!;

    expect(ai.inputs[0]).toMatchObject({ kind: "withdrawal", company: "Varna Trust Bank", stage: "screening", language: "bg", words: { min: 30, max: 70 } });
    expect(d.draft).toMatchObject({ language: "bg" });
    expect(d.text).toContain("оттеглям кандидатурата си");
    expect(d.mail).toEqual({ to: "careers@varnatrust.example", subject: "Withdrawing my application: Специалист информационна сигурност" });
    expect(d.outline.length).toBeGreaterThan(0);
  });
});

describe("declining an offer", () => {
  it("moves it to Withdrawn with the reason \"declined offer\", by you; it counts as withdrawn, its offer still a reply", async () => {
    const s = setup();
    const ardent = await s.add("Ardent Labs", "Detection Engineer", "offer", { appliedOn: "2026-09-20" });
    await s.add("Medora", "Full-stack Engineer", "applied", { appliedOn: "2026-09-21" });

    const r = await s.tracker.declineOffer(ardent);

    expect(r.event).toMatchObject({ kind: "status", cause: "you", from: "offer", to: "withdrawn", reason: "declined offer" });
    expect(await s.tracker.get(ardent)).toMatchObject({ status: "withdrawn", closedReason: "declined offer" });
    expect((await s.tracker.list()).counts).toMatchObject({ offer: 0, withdrawn: 1, rejected: 0 });
    expect((await s.tracker.stats()).responseRate).toMatchObject({ replied: 1, counted: 2 });
    // Declining offers no withdrawals: nothing was accepted.
    expect((await s.tracker.withdrawals()).items).toEqual([]);
  });

  it("is undoable: back to Offer", async () => {
    const s = setup();
    const ardent = await s.add("Ardent Labs", "Detection Engineer", "offer");
    const { event } = await s.tracker.declineOffer(ardent);

    await s.tracker.undoEvent(event.id);

    expect(await s.tracker.get(ardent)).toMatchObject({ status: "offer", closedReason: null });
  });

  it("is only for an Application at Offer", async () => {
    const s = setup();
    const id = await s.add("Medora", "Full-stack Engineer", "interviewing");

    await expect(s.tracker.declineOffer(id)).rejects.toMatchObject({ problem: "invalid" });
  });

  it("offers an optional gracious reply, drafted by the Track assistant, before declining", async () => {
    const body = "Thank you for the offer for the Detection Engineer role, and for the time your team spent with me. After a lot of thought I've decided to decline. I enjoyed our conversations about your detection pipeline and hope our paths cross again.";
    const ai = fakeAssistant({ body });
    const s = setup({ ai });
    const ardent = await s.add("Ardent Labs", "Detection Engineer", "offer", { contact: "lea.hristova@ardentlabs.example" });

    const d = await s.tracker.declineDraft(ardent);

    expect(ai.inputs[0]).toMatchObject({ kind: "decline", company: "Ardent Labs", stage: "offer", words: { min: 40, max: 80 } });
    expect(d).toMatchObject({ followUp: { kind: "decline" }, text: body, mail: { to: "lea.hristova@ardentlabs.example", subject: "Your offer: Detection Engineer" } });
    // Never a Needs-you item, and declining doesn't need it sent.
    expect((await s.tracker.needsYou()).items.some((i) => i.followUp.kind === "decline")).toBe(false);
    await expect(s.tracker.markFollowUpSent(d.followUp.id)).rejects.toMatchObject({ problem: "invalid" });
  });
});

describe("offer details", () => {
  /** The offer letter from Ardent Labs (made up), as the Track assistant reads it. */
  const offerEmail = mailMessage({
    id: "<offer-1@ardentlabs.example>", from: "Lea Hristova <lea.hristova@ardentlabs.example>", to: ["sample.jobs@example.com"],
    subject: "Your offer: Detection Engineer", receivedAt: "2026-10-12T09:40:00Z",
    text: "Dear Alex, we're delighted to offer you the Detection Engineer role. Base salary €3,100 gross per month, starting 1 December. Hybrid, 2 days a week in our Sofia office. Permanent contract with a 6-month probation. The full letter is attached; please reply by 6 November.",
    attachments: [{ name: "offer-letter.pdf", type: "application/pdf" }],
  });
  const reading: EmailClassification = {
    kind: "offer", confidence: 0.95, company: "Ardent Labs", jobTitle: "Detection Engineer", stage: null, language: "en", summary: null, interview: null,
    offer: { baseSalary: "€3,100 gross / month", startDate: "2026-12-01", workPattern: "Hybrid, 2 days a week in the Sofia office", contract: "Permanent, 6-month probation", other: "Reply by 6 November" },
  };

  /** Discover and Track on one database, with one mailbox read per check and a salary floor of €2,450 a month. */
  function withMail() {
    const clock = fakeClock();
    const mailbox = fakeMailbox(clock);
    const assistant: TrackAssistant = {
      estimateClassifyUsd: () => 0.0005,
      classify: async () => ({ classification: reading, costUsd: 0.0005, model: "fake/track-assistant" }),
      estimateDraftUsd: () => 0.002,
      draft: async () => { throw new Error("no drafts here"); },
      estimatePrepSheetUsd: () => 0.002,
      buildPrepSheet: async () => { throw new Error("not in these tests"); },
    };
    let tracker: Tracker | null = null;
    const t = createTestEngine({
      clock, mailReader: mailbox, aiMonthlyCapUsd: 10, searchSettings: { ...defaultSearchSettings, minMonthlySalaryEur: 2450 },
      onMailStored: (emails) => tracker!.processMail(emails),
    });
    tracker = createTracker({ db: t.deps.db, clock, discovery: t.engine, assistant, aiMonthlyCapUsd: 10 });
    return { ...t, tracker, mailbox };
  }

  it("are pre-filled from the offer email that moved it to Offer, and the base salary is compared with the floor", async () => {
    const s = withMail();
    const r = await s.tracker.addByHand({ job: { company: "Ardent Labs", title: "Detection Engineer" }, appliedOn: "2026-10-01", status: "interviewing", contact: "ardentlabs.example" });
    const id = r.outcome === "added" ? r.application.id : "";
    s.mailbox.deliver(offerEmail);
    await s.clock.advance(4 * 60 * 60_000);
    await s.engine.checkAll();

    const app = (await s.tracker.get(id))!;

    expect(app.status).toBe("offer");
    expect(app.offer).toMatchObject({
      details: reading.offer, from: "email",
      email: { subject: "Your offer: Detection Engineer", attachments: [{ name: "offer-letter.pdf" }] },
      floor: { floorEur: 2450, monthlyEur: 3100, verdict: "above" },
    });
  });

  it("are the user's once saved: edited, compared again (a yearly or BGN salary per month in euros)", async () => {
    const s = withMail();
    const r = await s.tracker.addByHand({ job: { company: "Ardent Labs", title: "Detection Engineer" }, appliedOn: "2026-10-01", status: "offer" });
    const id = r.outcome === "added" ? r.application.id : "";
    expect((await s.tracker.get(id))!.offer).toMatchObject({ from: null, details: { baseSalary: null }, floor: { floorEur: 2450, monthlyEur: null, verdict: "unknown" } });

    const saved = await s.tracker.saveOfferDetails(id, { baseSalary: "4,000 лв. gross / month", startDate: "2026-12-01", workPattern: " On-site ", contract: "", other: null });

    expect(saved.offer).toMatchObject({
      from: "you", details: { baseSalary: "4,000 лв. gross / month", startDate: "2026-12-01", workPattern: "On-site", contract: null, other: null },
      floor: { monthlyEur: 2045, verdict: "below" },
    });
    expect((await s.tracker.saveOfferDetails(id, { baseSalary: "€30,000 a year" })).offer.floor).toMatchObject({ monthlyEur: 2500, verdict: "above" });
    await expect(s.tracker.saveOfferDetails(id, { startDate: "next spring" })).rejects.toMatchObject({ problem: "invalid" });
  });
});
