// Apply's fill engine (#38) through its public interface: an in-memory database, the fake clock and
// Prepare's engine seeded through its own interface (Mira Petrova, made up). The extension reads the
// page and fills it; the engine decides which package a page belongs to and what goes in each field.
import { describe, expect, it } from "vitest";
import { createFillEngine, createTracker, fieldReportFixture, type FieldStructure, type FillPage, type PageReading, type ReadField } from "../src/index.ts";
import { fixtureFetch, memoryDb } from "./harness.ts";
import { memoryPackageFolder } from "./preparation-harness.ts";
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
      package: { id: pkg.id, version: 1, job: { title: "Security Engineer", company: "Kestrel Payments" }, cv: { fileName: pkg.approved!.cv.file.fileName, size: pkg.approved!.cv.file.size, ats: { passed: 10, total: 10 } }, letter: true },
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

  it("gives the national number when the country code is a field of its own, and says so", async () => {
    const t = await filling();
    const answers = t.fill.answer(t.sessionId, reading([field("code", "Country Phone Code"), field("phone", "Phone Number")]));

    expect(answers).toEqual([
      { fieldId: "code", kind: "fill", value: "+359", source: "profile", basis: null },
      { fieldId: "phone", kind: "fill", value: "88 000 0175", source: "profile", basis: "Without +359, which is in Country Phone Code" },
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
      field("why", "What would you change in your last team?", { kind: "textarea" }),
      field("pronouns", "Pronouns", { required: false }),
    ]));

    expect(answers).toEqual([
      { fieldId: "pw", kind: "skip", reason: "Passwords are yours: Chrome's password manager fills them" },
      { fieldId: "gdpr", kind: "skip", reason: "Consent boxes are yours to tick" },
      { fieldId: "why", kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null },
      { fieldId: "pronouns", kind: "skip", reason: "Optional, and apply-kit has no answer for it yet" },
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

describe("answering a page's file fields from the package", () => {
  it("attaches the package's CV to the CV field, named as in the package", async () => {
    const t = await filling();
    const cv = t.pkg.approved!.cv.file;

    const answers = t.fill.answer(t.sessionId, reading([field("resume", "Resume/CV", { kind: "file" })]));

    expect(answers).toEqual([
      { fieldId: "resume", kind: "file", which: "cv", fileName: "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf", size: cv.size, source: "package", basis: "Your package's CV, v1" },
    ]);
  });

  it("attaches the letter where the page has a file field for it, and pastes its text where there's only text", async () => {
    const t = await filling();
    const letter = t.pkg.approved!.letter!;

    const asFile = t.fill.answer(t.sessionId, reading([field("cover_letter", "Cover Letter", { kind: "file", required: false })]));
    const asText = t.fill.answer(t.sessionId, reading([field("cover_letter_text", "Cover Letter", { kind: "textarea", required: false })]));

    expect(asFile).toEqual([
      { fieldId: "cover_letter", kind: "file", which: "letter", fileName: "Mira_Petrova_Cover_Letter_Kestrel_Payments_Security_Engineer.pdf", size: letter.file.size, source: "package", basis: "Your package's letter, v1" },
    ]);
    expect(asText).toEqual([{ fieldId: "cover_letter_text", kind: "fill", value: letter.text, source: "package", basis: "Your package's letter, v1" }]);
  });

  it("uses one letter per page: with a file field for it, the text option is left empty", async () => {
    const t = await filling();

    const answers = t.fill.answer(t.sessionId, reading([
      field("cover_letter", "Cover Letter", { kind: "file", required: false }), field("cover_letter_text", "Cover Letter", { kind: "textarea", required: false }),
    ]));

    expect(answers.map((a) => a.kind)).toEqual(["file", "skip"]);
    expect(answers[1]).toEqual({ fieldId: "cover_letter_text", kind: "skip", reason: "Your letter is attached as a file" });
  });
});

describe("the package's files for attaching", () => {
  it("gives the frozen CV's bytes, name and size, and its copy in the Packages folder", async () => {
    const t = await filling();
    const frozen = (await t.preparation.packageFile(t.pkg.id, "cv"))!;

    const cv = await t.fill.packageFile(t.sessionId, "cv");

    expect(cv).toEqual({ which: "cv", fileName: "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf", size: frozen.size, path: "Packages/Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf", bytes: frozen.bytes });
    expect((await t.fill.packageFile(t.sessionId, "letter"))!.fileName).toBe("Mira_Petrova_Cover_Letter_Kestrel_Payments_Security_Engineer.pdf");
  });

  it("writes the file to the Packages folder on first use when approval couldn't copy it there", async () => {
    const db = memoryDb();
    const folder = memoryPackageFolder();
    // At approval the Packages folder wasn't there (a disconnected drive): the frozen file counts, without a copy.
    const offline = { ...folder, freeze: async (...a: Parameters<typeof folder.freeze>) => ({ ...(await folder.freeze(...a)), copy: null }) };
    const t = mira({ db, packages: offline, fetch: fixtureFetch({ [questions("4410")]: "greenhouse-kestrel-4410-questions.json" }) });
    const fill = createFillEngine({ db, clock: t.clock, prepare: t.preparation, track: createTracker({ db, clock: t.clock, discovery: t.discovery }), packages: folder });
    await approved(t);
    const r = await fill.startFill(page("4410"));
    if (r.kind !== "matched") throw new Error(r.kind);

    const cv = await fill.packageFile(r.session!.id, "cv");

    expect(cv!.path).toBe("Packages/Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf");
  });
});

describe("a Bulgarian package", () => {
  it("attaches the Bulgarian CV", async () => {
    const t = setup();
    // Kestrel's job with the package in Bulgarian.
    const draft = await started(t, kestrelJob({ packageLanguage: "bg" }));
    for (const step of ["target", "cv", "letter"] as const) expect(t.preparation.approveStep(draft.id, step)).toMatchObject({ approved: true });
    t.preparation.setScreeningAnswer(draft.id, "question_31003", "3400");
    // The form's own options are in English: Kris chooses one.
    t.preparation.setScreeningAnswer(draft.id, draft.answers!.questions.find((q) => q.question.startsWith("Do you have the right"))!.id, "Yes");
    const a = t.preparation.approveStep(draft.id, "answers");
    if (!a.approved) throw new Error(a.reason);
    const pkg = await t.preparation.approvePackage(draft.id);
    if (!pkg.approved) throw new Error(pkg.reason);
    const r = await t.fill.startFill(page("4410"));
    if (r.kind !== "matched") throw new Error(r.kind);

    const [answer] = t.fill.answer(r.session!.id, reading([field("resume", "Resume/CV", { kind: "file" })]));
    const file = await t.fill.packageFile(r.session!.id, "cv");

    expect(r.package.language).toBe("bg");
    expect(answer).toMatchObject({ kind: "file", which: "cv", fileName: pkg.package.approved!.cv.file.fileName, basis: "Your package's CV in Bulgarian, v1" });
    expect(file!.bytes).toEqual((await t.preparation.packageFile(draft.id, "cv"))!.bytes);
    // The template-like stand-in PDF reads back as text: the Bulgarian CV's section titles.
    expect(new TextDecoder().decode(file!.bytes)).toContain("Професионален опит");
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

/** Adds an answer to Mira's bank through Prepare's interface. */
function bank(t: Awaited<ReturnType<typeof filling>>, input: Parameters<typeof t.preparation.saveAnswer>[0]) {
  const r = t.preparation.saveAnswer(input);
  if (!r.saved) throw new Error(r.problems[0]!.message);
  return r.answer;
}
const yesNo = ["Yes", "No"];
const sponsorship = { question: "Do you require visa sponsorship?", wordings: ["Will you now or in the future require sponsorship?"], versions: { en: "No", bg: "Не" }, category: "standard", kind: "yes-no" } as const;

describe("answering questions from the answer bank", () => {
  it("fills an exact or alias match without asking", async () => {
    const t = await filling();
    bank(t, sponsorship);
    bank(t, { question: "Willing to relocate", wordings: ["Are you willing to relocate?", "Готови ли сте да се преместите?"], versions: { en: "No", bg: "Не" }, category: "standard", kind: "yes-no" });

    const answers = t.fill.answer(t.sessionId, reading([
      field("q1", "Do you require visa sponsorship?", { kind: "select", options: yesNo }),
      field("q2", "Are you willing to relocate?", { kind: "radio", options: yesNo }),
    ]));

    expect(answers).toEqual([
      { fieldId: "q1", kind: "fill", value: "No", source: "answer-bank", basis: null },
      { fieldId: "q2", kind: "fill", value: "No", source: "answer-bank", basis: null },
    ]);
  });

  it("fills a close wording above the bar, and names the entry it matched", async () => {
    const t = await filling();
    bank(t, { question: "Willing to relocate", wordings: ["Are you willing to relocate?"], versions: { en: "No" }, category: "standard", kind: "yes-no" });

    const [a] = t.fill.answer(t.sessionId, reading([field("q", "Are you willing to relocate to Sofia?", { kind: "select", options: yesNo })]));

    expect(a).toEqual({ fieldId: "q", kind: "fill", value: "No", source: "answer-bank", basis: 'Close wording of "Willing to relocate" in your answer bank' });
  });

  it("refuses a near match to a different question, and names it", async () => {
    const t = await filling();
    bank(t, { question: "Do you hold any security certifications?", versions: { en: "CompTIA Security+" }, category: "screening" });

    const [a] = t.fill.answer(t.sessionId, reading([field("q", "Do you hold a security clearance?", { kind: "radio", options: yesNo })]));

    expect(a).toEqual({
      fieldId: "q", kind: "needs-you", reason: "apply-kit has no answer for this yet",
      basis: 'The closest answer bank entry ("Do you hold any security certifications?") is a different question, so it wasn\'t used',
    });
  });

  it("refuses a close wording whose answer is the wrong kind for the field", async () => {
    const t = await filling();
    bank(t, { question: "Willing to relocate", wordings: ["Are you willing to relocate?"], versions: { en: "No" }, category: "standard", kind: "yes-no" });

    const [a] = t.fill.answer(t.sessionId, reading([field("q", "Are you willing to relocate to Sofia?", { kind: "textarea" })]));

    expect(a).toEqual({
      fieldId: "q", kind: "needs-you", reason: "The closest answer is a yes/no answer, and this field asks for text",
      basis: 'Close wording of "Willing to relocate" in your answer bank', suggestion: "No",
    });
  });

  it("records each use of an answer-bank entry through Prepare, once per session", async () => {
    const t = await filling();
    bank(t, sponsorship);
    const r = reading([field("q1", "Will you now or in the future require sponsorship?", { kind: "select", options: yesNo }), field("first_name", "First Name")]);
    const outcomes = [{ fieldId: "q1", outcome: "filled" as const, source: "answer-bank" as const }, { fieldId: "first_name", outcome: "filled" as const, source: "profile" as const }];
    const used = () => t.preparation.listAnswers({ search: "visa sponsorship" }).answers[0]!;
    expect(used().useCount).toBe(0);

    t.fill.recordPage(t.sessionId, r, outcomes);
    t.fill.recordPage(t.sessionId, r, outcomes);

    expect(used()).toMatchObject({ useCount: 1, lastUsedAt: "2026-10-12T07:30:00.000Z" });
  });
});

describe("turning an answer into the field's format", () => {
  it("maps yes/no between English and Bulgarian, and to options worded as sentences", async () => {
    const t = await filling();
    bank(t, sponsorship);

    const answers = t.fill.answer(t.sessionId, reading([
      field("q1", "Do you require visa sponsorship?", { kind: "select", options: ["Да", "Не"] }),
      field("q2", "Will you now or in the future require sponsorship?", { kind: "radio", options: ["Yes, I will", "No, I won't"] }),
    ]));

    expect(answers.map((a) => a.kind === "fill" && a.value)).toEqual(["Не", "No, I won't"]);

    bank(t, { question: "Нуждаете ли се от спонсорство за виза?", versions: { bg: "Не" }, category: "standard", kind: "yes-no" });
    const [bg] = t.fill.answer(t.sessionId, reading([field("q2", "Нуждаете ли се от спонсорство за виза?", { kind: "radio", options: ["Yes, I will", "No, I won't"] })]));
    expect(bg).toMatchObject({ kind: "needs-you", reason: "Your answer bank has this only in Bulgarian" });
  });

  it("puts '1 month' in the notice-period option that holds it", async () => {
    const t = await filling();
    const [a, b] = t.fill.answer(t.sessionId, reading([
      field("q1", "Notice period", { kind: "select", options: ["Immediately", "Less than 2 weeks", "2–4 weeks", "1–2 months", "More than 2 months"] }),
      field("q2", "Notice period", { kind: "select", options: ["Up to 1 month", "1 month or more"] }),
    ]));

    expect(a).toEqual({ fieldId: "q1", kind: "fill", value: "1–2 months", source: "package", basis: "Approved screening answer in this package" });
    // Two options hold it: all or nothing, so Kris picks.
    expect(b).toEqual({ fieldId: "q2", kind: "needs-you", reason: 'None of the options matches "1 month"', basis: "Approved screening answer in this package", suggestion: "1 month" });
  });

  it("puts a number in the range that holds it", async () => {
    const t = await filling();
    bank(t, { question: "Years of experience with SIEM tools", versions: { en: "4" }, category: "screening", kind: "number" });
    const [a] = t.fill.answer(t.sessionId, reading([field("q", "Years of experience with SIEM tools", { kind: "select", options: ["0-2", "3-5", "6+"] })]));
    expect(a).toMatchObject({ kind: "fill", value: "3-5" });
  });

  it("works out a relative start date from today", async () => {
    const t = await filling();
    bank(t, { question: "Earliest start date", wordings: ["When can you start?"], versions: { en: "Two weeks from offer" }, category: "standard", kind: "date" });

    const [date, text] = t.fill.answer(t.sessionId, reading([field("d", "Earliest start date", { kind: "date" }), field("t", "When can you start?")]));

    expect(date).toEqual({ fieldId: "d", kind: "fill", value: "2026-10-26", source: "answer-bank", basis: '"Two weeks from offer", counted from today' });
    expect(text).toEqual({ fieldId: "t", kind: "fill", value: "Two weeks from offer", source: "answer-bank", basis: null });
  });
});

describe("Kris's rules and the package's answers", () => {
  it("suggests salary from the rule, with the floor, and never fills it", async () => {
    const t = await filling();
    const [a] = t.fill.answer(t.sessionId, reading([field("s", "Expected gross monthly salary", { kind: "number" })]));
    expect(a).toEqual({
      fieldId: "s", kind: "needs-you", reason: "Your answer bank says: ask each time",
      basis: 'Your rule: "Upper half of the posting\'s stated range, never under €2,000 a month". The posting\'s range isn\'t known here, so this is your floor.',
      suggestion: "2000",
    });
  });

  it("suggests the salary Kris approved in the package for this job, still without filling it", async () => {
    const t = await filling();
    const [a] = t.fill.answer(t.sessionId, reading([field("s", "What are your salary expectations? (gross monthly, EUR)")]));
    expect(a).toEqual({
      fieldId: "s", kind: "needs-you", reason: "Your answer bank says: ask each time",
      basis: "You chose 3400 for this job when you approved the package.", suggestion: "3400",
    });
  });

  it("leaves voluntary diversity questions blank by rule, and says 'prefer not to say' only where the portal requires an answer", async () => {
    const t = await filling();
    const decline = ["Male", "Female", "Decline To Self Identify"];
    const answers = t.fill.answer(t.sessionId, reading([
      field("g", "Gender", { kind: "select", options: decline, required: false }),
      field("h", "Are you Hispanic/Latino?", { kind: "select", options: ["Yes", "No", "Decline To Self Identify"], required: false }),
      field("v", "Veteran Status", { kind: "select", options: ["I am not a protected veteran", "I don't wish to answer"], required: true }),
      field("d", "Disability Status", { kind: "select", options: ["Yes", "No"], required: true }),
    ]));

    expect(answers).toEqual([
      { fieldId: "g", kind: "skip", reason: "Your rule leaves voluntary questions blank", byRule: true },
      { fieldId: "h", kind: "skip", reason: "Your rule leaves voluntary questions blank", byRule: true },
      { fieldId: "v", kind: "fill", value: "I don't wish to answer", source: "answer-bank", basis: "This portal requires an answer, so your rule's \"Prefer not to say\"" },
      { fieldId: "d", kind: "needs-you", reason: "This portal requires an answer, and none of its options is \"Prefer not to say\"", basis: "Your rule leaves voluntary questions blank" },
    ]);
  });

  it("uses the package's approved screening answers for their own questions, ahead of the answer bank", async () => {
    const t = await filling();
    const notice = t.preparation.listAnswers({ search: "Notice period" }).answers[0]!;
    t.preparation.saveAnswer({ id: notice.id, question: notice.question, wordings: notice.wordings.map((w) => w.text), versions: { en: "2 months" }, category: "standard" });

    const answers = t.fill.answer(t.sessionId, reading([
      field("n", "What is your notice period?"),
      field("n2", "Notice period"),
      field("i", "Describe a security incident you handled.", { kind: "textarea", maxLength: 1000 }),
    ]));

    expect(answers[0]).toEqual({ fieldId: "n", kind: "fill", value: "1 month", source: "package", basis: "Approved screening answer in this package" });
    // The same question in other words is still the package's.
    expect(answers[1]).toMatchObject({ fieldId: "n2", kind: "fill", value: "1 month", source: "package" });
    expect(answers[2]).toMatchObject({ fieldId: "i", kind: "fill", source: "package", value: expect.stringMatching(/^At Northwind Bank I ran the response/) });
  });

  it("respects a field's character limit", async () => {
    const t = await filling();
    const [a] = t.fill.answer(t.sessionId, reading([field("i", "Describe a security incident you handled.", { kind: "textarea", maxLength: 100 })]));
    expect(a).toMatchObject({ fieldId: "i", kind: "needs-you", reason: "Your answer is 178 characters; this field takes 100", basis: "Approved screening answer in this package" });
  });
});

describe("Lever and Ashby pages (#43)", () => {
  it("gives Lever's one full-name field the profile's full name, and its Additional information box the letter", async () => {
    const t = await filling();
    const letter = t.pkg.approved!.letter!;

    const answers = t.fill.answer(t.sessionId, reading([
      field("name", "Full name"), field("location", "Current location", { kind: "typeahead", required: false }),
      field("comments", "Additional information", { kind: "textarea", required: false }),
    ]));

    expect(answers).toEqual([
      { fieldId: "name", kind: "fill", value: "Mira Petrova", source: "profile", basis: null },
      { fieldId: "location", kind: "fill", value: "Sofia, Bulgaria", source: "profile", basis: null },
      { fieldId: "comments", kind: "fill", value: letter.text, source: "package", basis: "Your package's letter, v1" },
    ]);
  });

  it("doesn't take a one-line Additional information field for the letter", async () => {
    const t = await filling();
    const [a] = t.fill.answer(t.sessionId, reading([field("extra", "Additional information", { required: false })]));
    expect(a).toMatchObject({ kind: "skip" });
  });

  it("answers Ashby's yes/no buttons from the answer bank, as a choice between the two", async () => {
    const t = await filling();
    bank(t, sponsorship);

    const [a] = t.fill.answer(t.sessionId, reading([field("q-sponsor", "Will you now or in the future require sponsorship?", { kind: "yes-no", options: yesNo })]));

    expect(a).toEqual({ fieldId: "q-sponsor", kind: "fill", value: "No", source: "answer-bank", basis: null });
  });
});

describe("field reports", () => {
  const phone: FieldStructure = {
    tag: "input", type: "tel", role: null, kind: "tel",
    attributes: { id: "phone", type: "tel", autocomplete: "tel-national", "aria-required": "true" },
    labelChain: [{ from: "label[for]", text: "Phone Number" }, { from: "placeholder", text: "e.g. 87 123 4567" }],
    options: [],
  };
  const address = "https://job-boards.greenhouse.io/kestrel/jobs/4410?gh_src=mira.petrova%40example.com&for=Mira#app";

  it("saves the field's structure with the portal, host and path, never the query", () => {
    const t = setup();

    const r = t.fill.reportField({ portal: "greenhouse", address, stepLabel: "My Information", field: phone });

    expect(r).toEqual({ id: expect.any(String), portal: "greenhouse", host: "job-boards.greenhouse.io", path: "/kestrel/jobs/4410", stepLabel: "My Information", field: phone, createdAt: "2026-10-12T07:30:00.000Z" });
    expect(JSON.stringify(t.fill.fieldReports())).not.toMatch(/gh_src|mira|Mira|#app/);
  });

  it("keeps only the structure: a value sent along, or a value attribute, is never stored", () => {
    const t = setup();
    const sent = { ...phone, value: "+359 88 000 0175", attributes: { ...phone.attributes, value: "+359 88 000 0175", "aria-valuetext": "+359 88 000 0175" } } as FieldStructure;

    t.fill.reportField({ portal: "greenhouse", address, stepLabel: null, field: sent });

    expect(t.fill.fieldReports()[0]!.field).toEqual(phone);
    expect(JSON.stringify(t.fill.fieldReports())).not.toContain("88 000 0175");
  });

  it("lists reports newest first, deletes one, and copies one as a fixture", async () => {
    const t = setup();
    const first = t.fill.reportField({ portal: "greenhouse", address, stepLabel: null, field: phone });
    await t.clock.advance(60_000);
    const code: FieldStructure = { tag: "select", type: null, role: null, kind: "select", attributes: { id: "phone_code" }, labelChain: [{ from: "label[for]", text: "Country Phone Code" }], options: ["+43", "+359"] };
    const second = t.fill.reportField({ portal: "greenhouse", address, stepLabel: null, field: code });

    expect(t.fill.fieldReports().map((r) => r.id)).toEqual([second.id, first.id]);
    expect(fieldReportFixture(first)).toBe([
      "<!-- Field report: greenhouse · job-boards.greenhouse.io/kestrel/jobs/4410 · reported 2026-10-12. Structure only, no values.",
      "     Label chain: label[for] \"Phone Number\" · placeholder \"e.g. 87 123 4567\". Wrap it in the portal's form to make a synthetic fixture. -->",
      "<div class=\"field\">",
      "  <label for=\"phone\">Phone Number</label>",
      "  <input id=\"phone\" type=\"tel\" autocomplete=\"tel-national\" aria-required=\"true\">",
      "</div>",
    ].join("\n"));
    expect(fieldReportFixture(second)).toContain("<select id=\"phone_code\"><option value=\"\">Select…</option><option>+43</option><option>+359</option></select>");

    expect(t.fill.deleteFieldReport(first.id)).toBe(true);
    expect(t.fill.deleteFieldReport(first.id)).toBe(false);
    expect(t.fill.fieldReports().map((r) => r.id)).toEqual([second.id]);
  });
});
