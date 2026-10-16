// The Package as sent on an Application (#35), through the tracker's public interface, wired to
// Prepare's engine as the service wires it (`trackPortsFrom`): Mira Petrova's made-up profile, Kestrel
// Payments' recorded Greenhouse board, Apply's fill engine marking the package submitted. Made-up
// people and companies only.
import { describe, expect, it } from "vitest";
import { createFillEngine, createTracker, trackPortsFrom, type PackageJob } from "../src/index.ts";
import { fixtureFetch, memoryDb } from "./harness.ts";
import { approved, kestrelJob, mira, started } from "./package-fixtures.ts";

const kestrelBoard = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs?content=true";
const kestrelQuestions = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs/4410?questions=true";

async function setup() {
  const db = memoryDb();
  const t = mira({ db, fetch: fixtureFetch({ [kestrelQuestions]: "greenhouse-kestrel-4410-questions.json", [kestrelBoard]: "greenhouse-kestrel.json" }) });
  const tracker = createTracker({ db, clock: t.clock, discovery: t.discovery, ...trackPortsFrom(t.preparation) });
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
  return { ...t, tracker, fill, jobId, submitted };
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
