// Apply's fill engine (#38) through its public interface: an in-memory database, the fake clock and
// Prepare's engine seeded through its own interface (Mira Petrova, made up). The extension reads the
// page and fills it; the engine decides which package a page belongs to and what goes in each field.
import { describe, expect, it } from "vitest";
import { createFillEngine, createTracker, type FillPage, type PageReading, type ReadField } from "../src/index.ts";
import { fixtureFetch, memoryDb } from "./harness.ts";
import { approved, kestrelJob, mira, started } from "./package-fixtures.ts";

const questions = (id: string) => `https://boards-api.greenhouse.io/v1/boards/kestrel/jobs/${id}?questions=true`;
const kestrelBoard = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs?content=true";

/** Mira with the fill engine on the same database and clock; Kestrel's two Greenhouse jobs answer the same recorded form. */
function setup() {
  const db = memoryDb();
  const t = mira({ db, fetch: fixtureFetch({ [questions("4410")]: "greenhouse-kestrel-4410-questions.json", [questions("4420")]: "greenhouse-kestrel-4410-questions.json", [kestrelBoard]: "greenhouse-kestrel.json" }) });
  const tracker = createTracker({ db, clock: t.clock, discovery: t.discovery });
  const fill = createFillEngine({ db, clock: t.clock, prepare: t.preparation, track: tracker });
  return { ...t, fill, tracker };
}

/** A second made-up Kestrel job on the same board: the same role in Plovdiv. */
const plovdivJob = kestrelJob({
  id: "job-kestrel-plovdiv",
  location: "Plovdiv",
  postings: [{ id: "posting-gh-2", site: "job-boards.greenhouse.io", url: "https://job-boards.greenhouse.io/kestrel/jobs/4420", firstSeenAt: "2026-10-10T08:00:00Z", source: { name: "Kestrel Payments", kind: "greenhouse", label: "Greenhouse", category: "ats" } }],
  target: { postingId: "posting-gh-2" },
});

const page = (jobId: string | null, board: string | null = "kestrel", host = "job-boards.greenhouse.io"): FillPage => ({
  portal: "greenhouse", host, jobRef: jobId ? { portal: "greenhouse", board, jobId } : null,
});

describe("matching the page to a package", () => {
  it("matches the page whose job ID is the package's target posting, and opens a fill session", async () => {
    const t = setup();
    const pkg = await approved(t);

    const r = await t.fill.startFill(page("4410"));

    expect(r).toMatchObject({
      kind: "matched", why: "job-id", continued: false,
      package: { id: pkg.id, version: 1, job: { title: "Security Engineer", company: "Kestrel Payments" }, cv: { fileName: pkg.approved!.cv.file.fileName, ats: { passed: 10, total: 10 } }, letter: true },
      session: { packageId: pkg.id, portal: "greenhouse", host: "job-boards.greenhouse.io", startedAt: "2026-10-12T07:30:00.000Z", endedAt: null },
    });
  });

  it("looks without opening a session when only asked which package fits", async () => {
    const t = setup();
    await approved(t);

    expect(await t.fill.matchPage(page("4410"))).toMatchObject({ kind: "matched", session: null });
  });

  it("keeps the session for the same job, and for a page without a job on the same host", async () => {
    const t = setup();
    await approved(t);
    const first = await t.fill.startFill(page("4410"));
    if (first.kind !== "matched") throw new Error(first.kind);

    const again = await t.fill.startFill(page("4410"), { sessionId: first.session!.id });
    const noRef = await t.fill.startFill(page(null), { sessionId: first.session!.id });

    expect(again).toMatchObject({ kind: "matched", continued: true, session: { id: first.session!.id } });
    expect(noRef).toMatchObject({ kind: "matched", continued: true, session: { id: first.session!.id } });
  });

  it("asks Kris to choose when approved packages exist on the same board but none targets this job", async () => {
    const t = setup();
    const pkg = await approved(t);

    const r = await t.fill.startFill(page("4499"));
    expect(r).toMatchObject({ kind: "choose", candidates: [{ id: pkg.id }] });

    const chosen = await t.fill.startFill(page("4499"), { packageId: pkg.id });
    expect(chosen).toMatchObject({ kind: "matched", why: "chosen", session: { packageId: pkg.id } });
  });

  it("says there's no package when nothing fits, and 'not approved yet' for a draft", async () => {
    const t = setup();
    const draft = await started(t);

    expect(await t.fill.startFill(page("4499", "vireo"))).toEqual({ kind: "no-package", job: null });
    expect(await t.fill.startFill(page("4410"))).toEqual({
      kind: "no-package", job: { id: "job-kestrel", packageId: draft.id, packageState: "draft", reason: "Your package isn't approved yet · open it to approve" },
    });
  });

  it("ends the session when the tab moved to a different job, and matches again", async () => {
    const t = setup();
    const first = await approved(t);
    const second = await approved(t, plovdivJob);
    const r1 = await t.fill.startFill(page("4410"));
    if (r1.kind !== "matched") throw new Error(r1.kind);
    await t.clock.advance(60_000);

    const peek = await t.fill.matchPage(page("4420"), { sessionId: r1.session!.id });
    expect(peek).toMatchObject({ kind: "different-job", then: { kind: "matched", session: null } });
    expect(t.fill.session(r1.session!.id)).toMatchObject({ endedAt: null });

    const r2 = await t.fill.startFill(page("4420"), { sessionId: r1.session!.id });

    expect(r2).toMatchObject({
      kind: "different-job",
      previous: { packageId: first.id, job: { title: "Security Engineer" }, jobRef: { jobId: "4410" } },
      then: { kind: "matched", package: { id: second.id }, session: { packageId: second.id } },
    });
    expect(t.fill.session(r1.session!.id)).toMatchObject({ endedAt: "2026-10-12T07:31:00.000Z", endReason: "different-job" });
    // Nothing is answered from the old package once its session has ended.
    expect(() => t.fill.answer(r1.session!.id, reading([field("first_name", "First Name")]))).toThrow(/ended/);
  });

  it("a different job with no package ends the session and says so", async () => {
    const t = setup();
    await approved(t);
    const r1 = await t.fill.startFill(page("4410"));
    if (r1.kind !== "matched") throw new Error(r1.kind);

    const r2 = await t.fill.startFill(page("4499", "vireo"), { sessionId: r1.session!.id });

    expect(r2).toMatchObject({ kind: "different-job", then: { kind: "no-package", job: null } });
  });
});

function field(id: string, label: string, more: Partial<ReadField> = {}): ReadField {
  return { id, label, kind: "text", required: true, value: "", options: [], maxLength: null, consent: false, password: false, hint: null, ...more };
}
function reading(fields: ReadField[]): PageReading {
  return { pageKind: "form", jobRef: { portal: "greenhouse", board: "kestrel", jobId: "4410" }, stepLabel: null, stepCount: null, fields };
}

async function filling() {
  const t = setup();
  const pkg = await approved(t);
  const r = await t.fill.startFill(page("4410"));
  if (r.kind !== "matched") throw new Error(r.kind);
  return { ...t, pkg, sessionId: r.session!.id };
}

describe("answering a page's contact fields from the master profile", () => {
  it("gives names, the job address, phone, location and links from the profile", async () => {
    const t = await filling();
    const fields = [
      field("first_name", "First Name"), field("last_name", "Last Name"), field("email", "Email", { kind: "email" }),
      field("phone", "Phone"), field("loc", "Location (City)"), field("country", "Country", { required: false }),
      field("q1", "LinkedIn Profile", { required: false }), field("q2", "Website", { required: false }), field("q3", "GitHub", { required: true }),
    ];

    const answers = t.fill.answer(t.sessionId, reading(fields));

    expect(answers).toEqual([
      { fieldId: "first_name", kind: "fill", value: "Mira", source: "profile", basis: null },
      { fieldId: "last_name", kind: "fill", value: "Petrova", source: "profile", basis: null },
      { fieldId: "email", kind: "fill", value: "mira.petrova@example.com", source: "profile", basis: "Your job address" },
      { fieldId: "phone", kind: "fill", value: "+359 88 000 0175", source: "profile", basis: null },
      { fieldId: "loc", kind: "fill", value: "Sofia", source: "profile", basis: null },
      { fieldId: "country", kind: "fill", value: "Bulgaria", source: "profile", basis: null },
      { fieldId: "q1", kind: "fill", value: "https://www.linkedin.com/in/mira-petrova-example", source: "profile", basis: null },
      { fieldId: "q2", kind: "skip", reason: "Your profile has no website" },
      { fieldId: "q3", kind: "needs-you", reason: "Your profile has no GitHub link", basis: null },
    ]);
  });

  it("matches by the field's autocomplete hint when the label is the portal's own wording", async () => {
    const t = await filling();
    const answers = t.fill.answer(t.sessionId, reading([field("a", "Vorname", { hint: "given-name" }), field("b", "Nachname", { hint: "family-name" })]));
    expect(answers.map((a) => a.kind === "fill" && a.value)).toEqual(["Mira", "Petrova"]);
  });

  it("never fills passwords or consent boxes, and leaves what it has no answer for to Kris", async () => {
    const t = await filling();
    const answers = t.fill.answer(t.sessionId, reading([
      field("pw", "Password", { kind: "text", password: true }),
      field("gdpr", "I agree to the privacy policy", { kind: "checkbox", consent: true }),
      field("why", "Why do you want to work at Kestrel Payments?", { kind: "textarea" }),
      field("pronouns", "Pronouns", { required: false }),
      field("resume", "Resume/CV", { kind: "file" }),
    ]));

    expect(answers).toEqual([
      { fieldId: "pw", kind: "skip", reason: "Passwords are yours: Chrome's password manager fills them" },
      { fieldId: "gdpr", kind: "skip", reason: "Consent boxes are yours to tick" },
      { fieldId: "why", kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null },
      { fieldId: "pronouns", kind: "skip", reason: "Optional, and apply-kit has no answer for it yet" },
      { fieldId: "resume", kind: "needs-you", reason: "Attach the CV yourself for now", basis: `Your package's CV: ${t.pkg.approved!.cv.file.fileName}` },
    ]);
  });

  it("picks the option that matches the profile, and leaves a dropdown without one to Kris", async () => {
    const t = await filling();
    const answers = t.fill.answer(t.sessionId, reading([
      field("c1", "Country", { kind: "select", options: ["Austria", "bulgaria", "Croatia"] }),
      field("c2", "Country", { kind: "select", options: ["EU", "Other"] }),
    ]));
    expect(answers).toEqual([
      { fieldId: "c1", kind: "fill", value: "bulgaria", source: "profile", basis: null },
      { fieldId: "c2", kind: "needs-you", reason: "None of the options matches your profile", basis: null, suggestion: "Bulgaria" },
    ]);
  });
});

describe("recording a page", () => {
  it("keeps the counts and each field's label, kind, outcome and source, never a value", async () => {
    const t = await filling();
    const r = reading([field("first_name", "First Name"), field("email", "Email", { value: "old@example.com" }), field("why", "Why us?", { kind: "textarea" })]);

    const recorded = t.fill.recordPage(t.sessionId, r, [
      { fieldId: "first_name", outcome: "filled", source: "profile" },
      { fieldId: "email", outcome: "kept", source: null },
      { fieldId: "why", outcome: "needs-you", source: null },
    ]);

    const expected = {
      stepLabel: null, pageKind: "form", filledAt: "2026-10-12T07:30:00.000Z",
      counts: { filled: 1, kept: 1, needsYou: 1, didntStick: 0, skipped: 0 },
      fields: [
        { label: "First Name", kind: "text", outcome: "filled", source: "profile" },
        { label: "Email", kind: "text", outcome: "kept", source: null },
        { label: "Why us?", kind: "textarea", outcome: "needs-you", source: null },
      ],
    };
    expect(recorded).toEqual(expected);
    expect(t.fill.pages(t.sessionId)).toEqual([expected]);
    expect(JSON.stringify(t.fill.pages(t.sessionId))).not.toMatch(/Mira|old@example|mira\.petrova/);
  });
});

/** A fill session for a package whose Job is in Discover, as every package's Job is outside these tests (Kestrel's board, recorded). */
async function submitting() {
  const t = setup();
  await t.discovery.addSource({ kind: "greenhouse", config: "kestrel" });
  await t.discovery.checkAll();
  const job = (await t.discovery.queryFeed({ view: "new" })).jobs.find((j) => j.title === "Security Engineer")!;
  const pkg = await approved(t, kestrelJob({ id: job.id }));
  const r = await t.fill.startFill(page("4410"));
  if (r.kind !== "matched") throw new Error(r.kind);
  return { ...t, pkg, jobId: job.id, sessionId: r.session!.id };
}

describe("marking as submitted", () => {
  const confirmation = "https://job-boards.greenhouse.io/kestrel/jobs/4410/confirmation";

  it("creates one Application in Applied with the job, package, portal, address and time, and ends the session", async () => {
    const t = await submitting();
    await t.clock.advance(5 * 60_000);

    const r = await t.fill.markSubmitted({ sessionId: t.sessionId }, { portalUrl: confirmation, via: "extension" });

    expect(r).toMatchObject({
      marked: true, alreadyMarked: false,
      application: {
        title: "Security Engineer", company: "Kestrel Payments", status: "applied", appliedOn: "2026-10-12",
        submission: { packageId: t.pkg.id, portal: "greenhouse", portalUrl: confirmation, submittedAt: "2026-10-12T07:35:00.000Z", via: "extension" },
      },
      package: { id: t.pkg.id, version: 1 },
    });
    if (!r.marked) throw new Error(r.reason);
    expect(await t.tracker.get(r.application.id)).toMatchObject({
      jobId: t.jobId, status: "applied", createdHow: "submission",
      submission: { packageId: t.pkg.id, portal: "greenhouse", portalUrl: confirmation, submittedAt: "2026-10-12T07:35:00.000Z", via: "extension" },
    });
    expect((await t.tracker.list()).total).toBe(1);
    expect(t.preparation.packageForApply({ packageId: t.pkg.id })).toMatchObject({ package: { state: "submitted", submitted: { via: "extension", portalUrl: confirmation } } });
    expect(t.fill.session(t.sessionId)).toMatchObject({ endedAt: "2026-10-12T07:35:00.000Z", endReason: "submitted" });
  });

  it("marks a package once: marking again, from the next Fill or the Job page, returns the first Application", async () => {
    const t = await submitting();
    const first = await t.fill.markSubmitted({ sessionId: t.sessionId }, { portalUrl: confirmation, via: "extension" });
    await t.clock.advance(60 * 60_000);
    const next = await t.fill.startFill(page("4410"), { sessionId: t.sessionId });
    if (next.kind !== "matched") throw new Error(next.kind);

    const again = await t.fill.markSubmitted({ sessionId: next.session!.id }, { portalUrl: confirmation, via: "extension" });
    const fromApp = await t.fill.markSubmitted({ packageId: t.pkg.id }, { portalUrl: null, via: "app" });

    if (!first.marked) throw new Error(first.reason);
    for (const r of [again, fromApp]) {
      expect(r).toMatchObject({ marked: true, alreadyMarked: true, application: { id: first.application.id, submission: { submittedAt: "2026-10-12T07:30:00.000Z", via: "extension" } } });
    }
    expect((await t.tracker.list()).total).toBe(1);
    expect(t.preparation.packageForApply({ packageId: t.pkg.id })).toMatchObject({ package: { submitted: { at: "2026-10-12T07:30:00.000Z", via: "extension" } } });
  });

  it("ends the tab's session, so the next Fill in the tab starts a new match", async () => {
    const t = await submitting();
    await t.fill.markSubmitted({ sessionId: t.sessionId }, { portalUrl: confirmation, via: "extension" });

    const next = await t.fill.startFill(page("4410"), { sessionId: t.sessionId });

    expect(next).toMatchObject({ kind: "matched", continued: false, session: { packageId: t.pkg.id, endedAt: null } });
    if (next.kind !== "matched") throw new Error(next.kind);
    expect(next.session!.id).not.toBe(t.sessionId);
  });

  it("marks from the Job page for an application sent elsewhere", async () => {
    const t = await submitting();

    const r = await t.fill.markSubmitted({ packageId: t.pkg.id }, { portalUrl: null, via: "app" });

    expect(r).toMatchObject({ marked: true, alreadyMarked: false, application: { status: "applied", submission: { portal: "greenhouse", portalUrl: null, via: "app" } } });
    expect(t.preparation.packageForApply({ packageId: t.pkg.id })).toMatchObject({ package: { state: "submitted", submitted: { via: "app" } } });
    // The tab's session is the extension's: marking in the app leaves it.
    expect(t.fill.session(t.sessionId)).toMatchObject({ endedAt: null });
  });

  it("undo removes the Application and makes the package approved again", async () => {
    const t = await submitting();
    const r = await t.fill.markSubmitted({ sessionId: t.sessionId }, { portalUrl: confirmation, via: "extension" });
    if (!r.marked) throw new Error(r.reason);

    expect(await t.fill.undoMarkSubmitted(r.application.id)).toEqual({ packageId: t.pkg.id });

    expect(await t.tracker.get(r.application.id)).toBeNull();
    expect((await t.tracker.list()).total).toBe(0);
    expect(t.preparation.packageForApply({ packageId: t.pkg.id })).toMatchObject({ package: { state: "approved", submitted: null } });
    // Marked again afterwards, it is a new Application.
    const again = await t.fill.markSubmitted({ packageId: t.pkg.id }, { portalUrl: null, via: "app" });
    expect(again).toMatchObject({ marked: true, alreadyMarked: false });
  });

  it("refuses undo once the Application has a later Event", async () => {
    const t = await submitting();
    const r = await t.fill.markSubmitted({ sessionId: t.sessionId }, { portalUrl: confirmation, via: "extension" });
    if (!r.marked) throw new Error(r.reason);
    await t.tracker.addNote(r.application.id, "Recruiter is Alex Doe");

    await expect(t.fill.undoMarkSubmitted(r.application.id)).rejects.toMatchObject({ problem: "not-undoable", message: expect.stringMatching(/can't be undone here/) });

    expect(await t.tracker.get(r.application.id)).toMatchObject({ status: "applied" });
    expect(t.preparation.packageForApply({ packageId: t.pkg.id })).toMatchObject({ package: { state: "submitted" } });
  });

  it("creates nothing when the Job already has an open Application added by hand, and names it", async () => {
    const t = await submitting();
    const byHand = await t.tracker.addByHand({ job: { jobId: t.jobId }, appliedOn: "2026-10-12", status: "applied", how: "i-applied" });
    if (byHand.outcome !== "added") throw new Error(byHand.outcome);

    const r = await t.fill.markSubmitted({ sessionId: t.sessionId }, { portalUrl: confirmation, via: "extension" });

    expect(r).toMatchObject({ marked: false, reason: expect.stringMatching(/already have an open Application/), application: { id: byHand.application.id } });
    expect((await t.tracker.list()).total).toBe(1);
    expect(t.preparation.packageForApply({ packageId: t.pkg.id })).toMatchObject({ package: { state: "approved" } });
  });
});
