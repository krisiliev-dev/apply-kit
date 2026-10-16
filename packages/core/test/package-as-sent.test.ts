// The Package as sent on an Application (#35), through the tracker's public interface, wired to
// Prepare's engine as the service wires it (`trackPortsFrom`): Mira Petrova's made-up profile, Kestrel
// Payments' recorded Greenhouse board, Apply's fill engine marking the package submitted. Made-up
// people and companies only.
import { describe, expect, it } from "vitest";
import { createFillEngine, createTracker, trackPortsFrom, type MailMessage, type PackageJob, type Tracker } from "../src/index.ts";
import { fixtureFetch, mailMessage, memoryDb } from "./harness.ts";
import { approved, kestrelJob, mira, started } from "./package-fixtures.ts";

const kestrelBoard = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs?content=true";
const kestrelQuestions = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs/4410?questions=true";

async function setup() {
  const db = memoryDb();
  // The job mailbox: every email delivered so far; each check reads it once and Track matches what's new.
  const inbox: MailMessage[] = [];
  let track: Tracker | null = null;
  const t = mira({
    db, fetch: fixtureFetch({ [kestrelQuestions]: "greenhouse-kestrel-4410-questions.json", [kestrelBoard]: "greenhouse-kestrel.json" }),
    mailReader: { fetchSince: async () => [...inbox] }, onMailStored: (emails) => track!.processMail(emails),
  });
  const tracker = createTracker({ db, clock: t.clock, discovery: t.discovery, ...trackPortsFrom(t.preparation) });
  track = tracker;
  const fill = createFillEngine({ db, clock: t.clock, prepare: t.preparation, track: tracker });
  await t.discovery.addSource({ kind: "greenhouse", config: "kestrel" });
  await t.discovery.checkAll();
  const jobId = (await t.discovery.queryFeed({ view: "new" })).jobs.find((j) => j.title === "Security Engineer")!.id;
  /** Approves Kestrel's package (in English, or in Bulgarian) and marks it submitted from the Job page. */
  const submitted = async (overrides: Partial<PackageJob> = {}) => {
    const pkg = overrides.packageLanguage === "bg" ? await approvedInBulgarian(t, kestrelJob({ id: jobId, ...overrides })) : await approved(t, kestrelJob({ id: jobId, ...overrides }));
    const r = await fill.markSubmitted({ packageId: pkg.id }, { portalUrl: null, via: "app" });
    if (!r.marked) throw new Error(r.reason);
    return { pkg, applicationId: r.application.id };
  };
  /** Delivers an email to the job mailbox and runs a check at the time given. */
  const receive = async (at: string, m: MailMessage) => {
    inbox.push(m);
    t.clock.set(at);
    await t.discovery.checkAll();
  };
  return { ...t, tracker, fill, jobId, submitted, receive };
}

/** A Bulgarian package approved: the form's own options are in English, so Kris chose one. */
async function approvedInBulgarian(t: ReturnType<typeof mira>, job: PackageJob) {
  const pkg = await started(t, job);
  for (const step of ["target", "cv", "letter"] as const) t.preparation.approveStep(pkg.id, step);
  t.preparation.setScreeningAnswer(pkg.id, "question_31003", "3400");
  t.preparation.setScreeningAnswer(pkg.id, pkg.answers!.questions.find((q) => q.question.startsWith("Do you have the right"))!.id, "Yes");
  const answers = t.preparation.approveStep(pkg.id, "answers");
  if (!answers.approved) throw new Error(answers.reason);
  const r = await t.preparation.approvePackage(pkg.id);
  if (!r.approved) throw new Error(r.reason);
  return r.package;
}

describe("the Package as sent", () => {
  it("shows Prepare's snapshot of the package as sent, and counts its CV version", async () => {
    const t = await setup();
    const { pkg, applicationId } = await t.submitted();
    const sent = t.preparation.packageSnapshot(pkg.id)!;

    const app = (await t.tracker.get(applicationId))!;

    expect(app.package).toEqual(sent);
    expect(app.package).toMatchObject({
      id: pkg.id, version: 1, state: "submitted", language: "en", angle: "security",
      job: { title: "Security Engineer", company: "Kestrel Payments" },
      cv: { label: pkg.approved!.cv.label }, letter: { text: expect.stringMatching(/\w/) },
      answers: expect.arrayContaining([expect.objectContaining({ question: expect.any(String), answer: "3400" })]),
    });
    expect(app.cvVersion).toBe(pkg.approved!.cv.label);
  });

  it("hands out the CV PDF and the letter exactly as approved", async () => {
    const t = await setup();
    const { pkg, applicationId } = await t.submitted();
    const asApproved = (await t.preparation.packageFile(pkg.id, "cv"))!;

    const cv = (await t.tracker.packageFile(applicationId, "cv"))!;
    const letter = await t.tracker.packageFile(applicationId, "letter");

    expect(cv).toMatchObject({ fileName: asApproved.fileName, sha256: asApproved.sha256 });
    expect(new TextDecoder().decode(cv.bytes.subarray(0, 5))).toBe("%PDF-");
    expect(letter).toMatchObject({ fileName: expect.stringMatching(/\.pdf$/) });
  });

  it("shows a Bulgarian package as sent, in Bulgarian", async () => {
    const t = await setup();
    const { applicationId } = await t.submitted({ packageLanguage: "bg" });

    const app = (await t.tracker.get(applicationId))!;

    expect(app.package).toMatchObject({ language: "bg", letter: { text: expect.stringMatching(/[а-яА-Я]/) } });
  });

  it("has no Package for an Application added by hand, until a package is marked submitted for its Job", async () => {
    const t = await setup();
    const byHand = await t.tracker.addByHand({ job: { jobId: t.jobId }, appliedOn: "2026-10-11", status: "applied", how: "i-applied" });
    if (byHand.outcome !== "added") throw new Error(byHand.outcome);
    expect(await t.tracker.get(byHand.application.id)).toMatchObject({ package: null, cvVersion: null });
    expect(await t.tracker.packageFile(byHand.application.id, "cv")).toBeNull();

    const { pkg } = await t.submitted();

    expect(await t.tracker.get(byHand.application.id)).toMatchObject({ package: { id: pkg.id }, cvVersion: pkg.approved!.cv.label });
  });

  it("counts Applications under their Package's CV version in What's working", async () => {
    const t = await setup();
    const { pkg } = await t.submitted();
    await t.clock.advance(14 * 24 * 60 * 60_000);

    const { working } = await t.tracker.stats();

    expect(working.cvVersion).toEqual([expect.objectContaining({ name: pkg.approved!.cv.label, sent: 1, replied: 0 })]);
  });
});

/** Greenhouse's confirmation for Kestrel's Security Engineer job (synthetic). */
const kestrelConfirmation = mailMessage({
  id: "<conf-4410.kestrel@us.greenhouse-mail.io>",
  from: "Kestrel Payments <no-reply@us.greenhouse-mail.io>",
  to: ["sample.jobs@example.com"],
  subject: "Thank you for applying to Kestrel Payments",
  receivedAt: "2026-10-13T18:20:00Z",
  text: "Hi Mira,\n\nThank you for your interest in Kestrel Payments! We received your application for the Security Engineer role and will be in touch.\n\nKestrel Payments Recruiting",
});

describe("a confirmation for an approved package with no Application", () => {
  /** Mira approved Kestrel's package, then applied by phone and forgot to mark it submitted. */
  async function forgotten() {
    const t = await setup();
    const pkg = await approved(t, kestrelJob({ id: t.jobId }));
    await t.receive("2026-10-14T07:00:00Z", kestrelConfirmation);
    return { ...t, pkg };
  }

  it("asks under Needs you to mark it Applied, dated the day of the email, and never adds an Application by itself", async () => {
    const t = await forgotten();

    const needs = await t.tracker.needsYou();

    expect(needs.packageConfirmations).toEqual([{
      email: expect.objectContaining({ id: kestrelConfirmation.id, subject: "Thank you for applying to Kestrel Payments" }),
      package: { id: t.pkg.id, job: { title: "Security Engineer", company: "Kestrel Payments" }, language: "en" },
      appliedOn: "2026-10-13",
      signals: expect.arrayContaining([expect.stringContaining("Kestrel Payments")]),
    }]);
    expect(needs.count).toBe(1);
    expect((await t.tracker.list()).total).toBe(0);
    expect(await t.tracker.emailsToMatch()).toEqual([]);
    expect(t.preparation.packageSnapshot(t.pkg.id)).toMatchObject({ state: "approved", submitted: null });
  });

  it("\"Mark Applied\" records the submission dated the email, and files the email on the Application", async () => {
    const t = await forgotten();

    const r = await t.tracker.answerPackageConfirmation(kestrelConfirmation.id, "mark-applied");

    const app = (await t.tracker.get(r.application!.id))!;
    expect(app).toMatchObject({
      jobId: t.jobId, status: "applied", appliedOn: "2026-10-13", createdHow: "submission",
      submission: { packageId: t.pkg.id, submittedAt: "2026-10-13T18:20:00.000Z", via: "email" }, package: { id: t.pkg.id },
    });
    expect(app.timeline.map((e) => [e.kind, e.text, e.detail])).toEqual([
      ["email", "Confirmation, filed", null],
      ["created", "Submitted → Applied", "Marked Applied from its confirmation email"],
    ]);
    expect(t.preparation.packageSnapshot(t.pkg.id)).toMatchObject({ state: "submitted", submitted: { at: "2026-10-13T18:20:00.000Z" } });
    expect((await t.tracker.needsYou()).packageConfirmations).toEqual([]);
  });

  it("undo of \"Mark Applied\" takes the Application off, makes the package approved again and asks again", async () => {
    const t = await forgotten();
    const r = await t.tracker.answerPackageConfirmation(kestrelConfirmation.id, "mark-applied");

    await t.tracker.undoPackageConfirmation(kestrelConfirmation.id);

    expect(await t.tracker.get(r.application!.id)).toBeNull();
    expect((await t.tracker.list()).total).toBe(0);
    expect(t.preparation.packageSnapshot(t.pkg.id)).toMatchObject({ state: "approved", submitted: null });
    expect((await t.tracker.needsYou()).packageConfirmations).toEqual([expect.objectContaining({ package: expect.objectContaining({ id: t.pkg.id }) })]);
  });

  it("refuses that undo once something else has happened to the Application", async () => {
    const t = await forgotten();
    const r = await t.tracker.answerPackageConfirmation(kestrelConfirmation.id, "mark-applied");
    await t.tracker.addNote(r.application!.id, "Recruiter is Alex Doe");

    await expect(t.tracker.undoPackageConfirmation(kestrelConfirmation.id)).rejects.toMatchObject({ problem: "not-undoable" });
    expect(await t.tracker.get(r.application!.id)).toMatchObject({ status: "applied" });
  });

  it("\"Not this package\" adds nothing and leaves the email to match by hand", async () => {
    const t = await forgotten();

    await t.tracker.answerPackageConfirmation(kestrelConfirmation.id, "not-this");

    expect((await t.tracker.needsYou()).packageConfirmations).toEqual([]);
    expect((await t.tracker.list()).total).toBe(0);
    expect(await t.tracker.emailsToMatch()).toEqual([expect.objectContaining({ email: expect.objectContaining({ id: kestrelConfirmation.id }) })]);
    expect(t.preparation.packageSnapshot(t.pkg.id)).toMatchObject({ state: "approved" });
  });

  it("files the confirmation on the Application, without asking, once the package was marked submitted", async () => {
    const t = await setup();
    const { applicationId } = await t.submitted();

    await t.receive("2026-10-14T07:00:00Z", kestrelConfirmation);

    expect((await t.tracker.needsYou()).packageConfirmations).toEqual([]);
    expect((await t.tracker.get(applicationId))!.timeline[0]).toMatchObject({ kind: "email", text: "Confirmation, filed" });
  });
});

describe("picking a CV version for an Application added by hand", () => {
  it("offers the CV versions of the Packages sent, and counts the Application under the one picked", async () => {
    const t = await setup();
    const { pkg } = await t.submitted();
    const label = pkg.approved!.cv.label;
    const byHand = await t.tracker.addByHand({ job: { company: "Vireo Systems", title: "SOC Analyst" }, appliedOn: "2026-10-12", status: "applied" });
    if (byHand.outcome !== "added") throw new Error(byHand.outcome);

    expect(await t.tracker.cvVersions()).toEqual([label]);
    const r = await t.tracker.pickCvVersion(byHand.application.id, label);

    expect(r.event).toMatchObject({ kind: "cv", cause: "you", text: `CV version picked: ${label}` });
    expect(await t.tracker.get(byHand.application.id)).toMatchObject({ cvVersion: label, cv: null, package: null });
    await t.clock.advance(14 * 24 * 60 * 60_000);
    expect((await t.tracker.stats()).working.cvVersion).toEqual([expect.objectContaining({ name: label, sent: 2 })]);
  });

  it("refuses a version that isn't one of them, and an Application with its Package as sent", async () => {
    const t = await setup();
    const { pkg, applicationId } = await t.submitted();
    const byHand = await t.tracker.addByHand({ job: { company: "Vireo Systems", title: "SOC Analyst" }, appliedOn: "2026-10-12", status: "applied" });
    if (byHand.outcome !== "added") throw new Error(byHand.outcome);

    await expect(t.tracker.pickCvVersion(byHand.application.id, "Made-up v9")).rejects.toMatchObject({ problem: "invalid" });
    await expect(t.tracker.pickCvVersion(applicationId, pkg.approved!.cv.label)).rejects.toMatchObject({ problem: "invalid" });
  });
});
