import { describe, expect, it, vi } from "vitest";
import type { PackageJob, PieceInput } from "../src/index.ts";
import { memoryDb } from "./harness.ts";
import { createTestPreparation, fakeWriter, recordedTailoredCv } from "./preparation-harness.ts";

// Packages through the preparation engine (ticket #62): the Prepare button's states, starting a
// package, its parts and steps. Made-up people, companies and postings only.

/** Mira Petrova's made-up master profile: one security role with results, a skill and a degree. */
function miraProfile(options: Parameters<typeof createTestPreparation>[0] = {}) {
  const t = createTestPreparation(options);
  const ids: Record<string, string> = {};
  const save = (key: string, input: PieceInput) => {
    const r = t.preparation.savePiece(input);
    if (!r.saved) throw new Error(`${key}: ${r.problems[0]!.message}`);
    ids[key] = r.piece.id;
  };
  save("analyst", { kind: "role", text: "", entry: { title: "Security Analyst", organisation: "Northwind Bank", city: "Sofia", start: "2022-03", end: null }, tags: ["SOC"], angles: ["security"] });
  save("detections", { kind: "achievement", text: "Wrote 30 detection rules that cut false alerts by a quarter.", belongsTo: ids.analyst, tags: ["SIEM"], angles: ["security"], numberSource: "measured" });
  save("phishing", { kind: "achievement", text: "Ran the response to a phishing campaign against the claims team.", belongsTo: ids.analyst, tags: ["incident response"], angles: ["security"] });
  save("wazuh", { kind: "skill", text: "Wazuh", tags: ["SIEM"], angles: ["security"] });
  save("degree", { kind: "education", text: "", entry: { title: "BSc Computer Science", organisation: "Danube Institute of Technology", city: "Ruse", start: "2018-09", end: "2022-06" }, angles: ["security", "developer"] });
  t.preparation.saveContact({ nameLatin: "Mira Petrova", nameCyrillic: "Мира Петрова", email: "mira.petrova@example.com", phone: "+359 88 000 0175", city: "Sofia", country: "Bulgaria", links: ["linkedin.com/in/mira-petrova-example"] });
  return { ...t, ids };
}

/** A made-up Kestrel Payments job as Discover reads it: the company's Greenhouse page and a dev.bg copy. */
function kestrelJob(overrides: Partial<PackageJob> = {}): PackageJob {
  return {
    id: "job-kestrel",
    title: "Security Engineer",
    titleTranslation: null,
    company: "Kestrel Payments",
    location: "Sofia",
    packageLanguage: "en",
    closed: null,
    reading: { state: "read" },
    requirements: [{ text: "Experience triaging alerts in a SIEM" }, { text: "Incident response" }],
    postings: [
      { id: "posting-devbg", site: "dev.bg", url: "https://dev.bg/company/jobads/kestrel-security-engineer/", source: { name: "dev.bg IT security", kind: "devbg", label: "dev.bg", category: "aggregator" } },
      { id: "posting-gh", site: "job-boards.greenhouse.io", url: "https://job-boards.greenhouse.io/kestrel/jobs/4410", source: { name: "Kestrel Payments", kind: "greenhouse", label: "Greenhouse", category: "ats" } },
    ],
    target: { postingId: "posting-devbg" },
    ...overrides,
  };
}

describe("whether a package can start", () => {
  it("can start for an open, read job once there's a master profile", () => {
    const t = miraProfile();
    expect(t.preparation.prepareStatus(kestrelJob())).toEqual({ canStart: true, package: null });
  });

  it("says why it can't: a closed job, a posting not read yet, no master profile", () => {
    const t = miraProfile();
    const closed = kestrelJob({ closed: { at: "2026-10-10T09:00:00Z", how: "No longer listed by Kestrel Payments", decisionId: "d1" } });
    expect(t.preparation.prepareStatus(closed)).toMatchObject({
      canStart: false, problem: "closed",
      reason: "Can't prepare a package: this job is closed (no longer listed by Kestrel Payments), so the posting may no longer accept applications. If it's still open, reopen it first.",
    });
    expect(t.preparation.prepareStatus(kestrelJob({ reading: { state: "unscreened" } }))).toMatchObject({
      canStart: false, problem: "not-read",
      reason: "Can't prepare a package yet: the posting's requirements haven't been read, and every part of a package is built against them.",
    });
    expect(createTestPreparation().preparation.prepareStatus(kestrelJob())).toMatchObject({
      canStart: false, problem: "no-profile",
      reason: "A package needs your master profile first: every part is built from it.",
    });
  });
});

/** Starts Kestrel's package and waits until nothing is being written. */
async function started(t: ReturnType<typeof miraProfile>, job = kestrelJob()) {
  const r = t.preparation.startPackage(job);
  if (!r.started) throw new Error(r.reason);
  return (await t.preparation.packageSettled(r.package.id))!;
}

describe("starting a package", () => {
  it("starts from the closest angle, the company's own page and the posting's language, writing the CV in the background", async () => {
    const t = miraProfile();

    const r = t.preparation.startPackage(kestrelJob());

    expect(r).toMatchObject({
      started: true,
      package: {
        jobId: "job-kestrel", title: "Security Engineer", company: "Kestrel Payments", startedAt: "2026-10-12T07:30:00.000Z",
        language: "en", postingLanguage: "en", angle: { angle: "security", label: "Security" },
        targetPostingId: "posting-gh", generating: true, photo: false,
        chip: { kind: "preparing", label: "Preparing package", step: 1 },
        estimate: { costUsd: 0.002, seconds: 20 },
      },
    });
    if (!r.started) return;
    expect(r.package.parts.map((p) => [p.part, p.state])).toEqual([
      ["target", "done"], ["cv", "working"], ["letter", "later"], ["answers", "later"], ["ats", "waiting"],
    ]);
    expect(r.package.targetOptions).toEqual([
      { postingId: "posting-gh", site: "job-boards.greenhouse.io", url: "https://job-boards.greenhouse.io/kestrel/jobs/4410", recommended: true, consequence: "The company's own page. Your CV goes straight into their system and no account is needed." },
      { postingId: "posting-devbg", site: "dev.bg", url: "https://dev.bg/company/jobads/kestrel-security-engineer/", recommended: false, consequence: "A job board's copy. It may forward you to the company's form and mark you as coming from dev.bg. Pick it only if you want the board credited." },
    ]);
  });

  it("finishes as a ready package with the CV printed from the angle's pieces, and its cost", async () => {
    const t = miraProfile();

    const pkg = await started(t);

    expect(pkg).toMatchObject({ generating: false, partsReady: 2, costUsd: 0.002, estimate: { costUsd: 0, seconds: 0 }, chip: { kind: "ready", label: "Package ready" } });
    expect(pkg.cv).toMatchObject({ fileName: "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf", pages: 1, overflow: null, language: "en", photo: false });
    const file = await t.preparation.packageCv(pkg.id);
    const printed = new TextDecoder().decode(file!.pdf);
    // The placeholder CV is the pieces as stored; the model's tailored lines wait for the honesty check (#63).
    expect(printed).toContain("Wrote 30 detection rules that cut false alerts by a quarter");
    expect(printed).toContain("Northwind Bank");
    expect(printed).toContain("Wazuh");
    expect(printed).not.toContain(recordedTailoredCv.lines[1]!.text);
  });

  it("is one package per job: starting again returns the same one", async () => {
    const t = miraProfile();
    const first = await started(t);
    const again = t.preparation.startPackage(kestrelJob());
    expect(again).toMatchObject({ started: true, package: { id: first.id } });
  });

  it("counts towards the angle it started from", async () => {
    const t = miraProfile();
    await started(t);
    expect(t.preparation.angles().find((a) => a.angle === "security")!.packagesUsed).toBe(1);
  });

  it("starts in Bulgarian for a Bulgarian posting, with the name as stored in Cyrillic", async () => {
    const t = miraProfile();
    const pkg = await started(t, kestrelJob({ packageLanguage: "bg" }));
    expect(pkg).toMatchObject({ language: "bg", postingLanguage: "bg", cv: { language: "bg", fileName: "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf" } });
    expect(new TextDecoder().decode((await t.preparation.packageCv(pkg.id))!.pdf)).toContain("Мира Петрова");
  });
});

describe("the package chip on the Job page and the Feed", () => {
  it("says Package ready, then Continue package at the step Kris is at", async () => {
    const t = miraProfile();
    const pkg = await started(t);
    expect(t.preparation.packageChips(["job-kestrel", "job-other"])).toEqual({
      "job-kestrel": { packageId: pkg.id, kind: "ready", label: "Package ready", step: 1 },
    });

    t.preparation.approveStep(pkg.id, "target");

    expect(t.preparation.prepareStatus(kestrelJob())).toEqual({
      canStart: true, package: { packageId: pkg.id, kind: "continue", label: "Continue package · step 2 of 5", step: 2 },
    });
  });
});

describe("approving steps in order", () => {
  it("can't approve a step before the ones above it, and says which comes first", async () => {
    const t = miraProfile();
    const pkg = await started(t);

    const refused = t.preparation.approveStep(pkg.id, "cv");

    expect(refused).toMatchObject({
      approved: false, blockedBy: "target",
      reason: "Approve step 1, Target posting, first. Steps are approved in order, so a later part never contradicts an earlier decision.",
    });
    expect(refused.package.steps.map((s) => [s.state, s.sub])).toEqual([
      ["current", "Choose"], ["upcoming", "Drafted"], ["upcoming", "Not built yet"], ["upcoming", "Not built yet"], ["upcoming", "After the CV"],
    ]);
  });

  it("lets later steps be read before they can be approved", async () => {
    const t = miraProfile();
    const pkg = await started(t);
    // The CV is readable (and downloadable as a draft) while step 1 still waits.
    expect(pkg.steps[1]).toMatchObject({ step: "cv", state: "upcoming", blocked: expect.stringContaining("Approve step 1") });
    expect(await t.preparation.packageCv(pkg.id)).not.toBeNull();
  });

  it("approves step 1 then step 2, and stops at a step not built yet", async () => {
    const t = miraProfile();
    const pkg = await started(t);

    expect(t.preparation.approveStep(pkg.id, "target")).toMatchObject({ approved: true });
    const cv = t.preparation.approveStep(pkg.id, "cv");
    const letter = t.preparation.approveStep(pkg.id, "letter");

    expect(cv).toMatchObject({ approved: true });
    expect(letter).toMatchObject({ approved: false, blockedBy: "letter", reason: "The cover letter arrives with a later part of the rebuild." });
    expect(letter.package.steps.map((s) => [s.state, s.sub])).toEqual([
      ["done", "Approved"], ["done", "Approved"], ["current", "Not built yet"], ["upcoming", "Not built yet"], ["upcoming", "After the CV"],
    ]);
  });

  it("reopens the approved steps when the target posting or language changes", async () => {
    const t = miraProfile();
    const pkg = await started(t);
    t.preparation.approveStep(pkg.id, "target");
    t.preparation.approveStep(pkg.id, "cv");

    const changed = t.preparation.setTargetPosting(pkg.id, "posting-devbg");

    expect(changed).toMatchObject({ changed: true, package: { targetPostingId: "posting-devbg", chip: { label: "Continue package · step 1 of 5" } } });
    expect(changed.package.steps.slice(0, 2).map((s) => s.state)).toEqual(["current", "upcoming"]);
  });
});

describe("the target posting and the language", () => {
  it("refuses a posting that isn't the job's", async () => {
    const t = miraProfile();
    const pkg = await started(t);
    expect(t.preparation.setTargetPosting(pkg.id, "posting-elsewhere")).toMatchObject({ changed: false, reason: "That posting isn't one of this job's." });
  });

  it("switching the language prints the CV again in that language, without the model", async () => {
    const writer = fakeWriter();
    const u = miraProfile({ writer });
    const pkg = await started(u);

    const switched = await u.preparation.setPackageLanguage(pkg.id, "bg");

    expect(switched).toMatchObject({ changed: true, package: { language: "bg", postingLanguage: "en", cv: { language: "bg" } } });
    expect(writer.calls.filter((c) => c.task === "tailor-cv")).toHaveLength(1);
    expect(new TextDecoder().decode((await u.preparation.packageCv(pkg.id))!.pdf)).toContain("Мира Петрова");
  });
});

describe("the photo", () => {
  it("is off by default, and can't be switched on without a photo in Profile", async () => {
    const t = miraProfile();
    const pkg = await started(t);
    expect(pkg).toMatchObject({ photo: false, photoAvailable: false });
    expect(await t.preparation.setPackagePhoto(pkg.id, true)).toMatchObject({ changed: false, reason: "There's no photo in Profile yet. Add one under Contact details first." });
  });

  it("switched on, prints the CV again with it and reopens the CV step", async () => {
    const t = miraProfile();
    await t.preparation.setPhoto({ fileName: "mira.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) });
    const pkg = await started(t);
    t.preparation.approveStep(pkg.id, "target");
    t.preparation.approveStep(pkg.id, "cv");

    const r = await t.preparation.setPackagePhoto(pkg.id, true);

    expect(r).toMatchObject({ changed: true, package: { photo: true, cv: { photo: true }, chip: { label: "Continue package · step 2 of 5" } } });
  });
});

/** A writer whose CV answer waits until the test lets it go. */
function heldWriter() {
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  const writer = fakeWriter({ tailorCv: async () => { await held; return recordedTailoredCv; } });
  return { writer, release: () => release() };
}

describe("stopping, the cap and failures", () => {
  it("Stop generating keeps the finished parts and marks the unfinished ones stopped", async () => {
    const { writer, release } = heldWriter();
    const t = miraProfile({ writer });
    const r = t.preparation.startPackage(kestrelJob());
    if (!r.started) throw new Error(r.reason);
    await vi.waitFor(() => expect(writer.calls).toHaveLength(1));

    const stopped = t.preparation.stopGenerating(r.package.id);
    release();
    const after = await t.preparation.packageSettled(r.package.id);

    expect(stopped.parts.map((p) => [p.part, p.state])).toEqual([
      ["target", "done"], ["cv", "stopped"], ["letter", "later"], ["answers", "later"], ["ats", "waiting"],
    ]);
    expect(after).toMatchObject({ generating: false, cv: null, stoppedAt: "2026-10-12T07:30:00.000Z", chip: { kind: "continue", label: "Continue package · step 1 of 5" } });
    expect(after!.parts[1]).toMatchObject({ state: "stopped", what: "Stopped before it was written. Generate it again when you like." });
    // The call was already made, so it's paid for and counted.
    expect(after!.costUsd).toBe(0.002);
  });

  it("a stopped part can be written again with Retry", async () => {
    const { writer, release } = heldWriter();
    const t = miraProfile({ writer });
    const r = t.preparation.startPackage(kestrelJob());
    if (!r.started) throw new Error(r.reason);
    t.preparation.stopGenerating(r.package.id);
    release();
    await t.preparation.packageSettled(r.package.id);

    expect(t.preparation.retryPart(r.package.id, "cv")).toMatchObject({ changed: true, package: { generating: true, stoppedAt: null } });
    const after = await t.preparation.packageSettled(r.package.id);
    expect(after).toMatchObject({ chip: { label: "Package ready" } });
    expect(after!.parts[1]).toMatchObject({ state: "done" });
  });

  it("doesn't start a part that would cross the monthly cap, and says so", async () => {
    const writer = fakeWriter({}, { estimateUsd: 0.02 });
    const t = miraProfile({ writer, capUsd: 0.01 });

    const pkg = await started(t);

    expect(writer.calls.filter((c) => c.task === "tailor-cv")).toEqual([]);
    expect(pkg.parts[1]).toMatchObject({ part: "cv", state: "not-written", what: "Not written: this month's AI budget would be crossed.", costUsd: 0 });
    expect(pkg.parts[0]).toMatchObject({ part: "target", state: "done" });
    expect(pkg.steps[1]).toMatchObject({ sub: "Not written" });
    expect(t.preparation.budget()).toMatchObject({ spentUsd: 0, reached: true });
  });

  it("retries a failed part once by itself, then shows it failed with the reason, keeping the rest", async () => {
    const writer = fakeWriter({ tailorCv: new Error("The model didn't answer within 90 seconds") });
    const t = miraProfile({ writer });

    const pkg = await started(t);

    expect(writer.calls.filter((c) => c.task === "tailor-cv")).toHaveLength(2);
    expect(pkg.parts[1]).toMatchObject({ state: "failed", attempts: 2, error: "The model didn't answer within 90 seconds" });
    expect(pkg.steps[1]).toMatchObject({ state: "failed", sub: "Failed" });
    expect(pkg.parts[0]).toMatchObject({ state: "done" });
    expect(t.preparation.approveStep(pkg.id, "target")).toMatchObject({ approved: true });
  });

  it("uses the second try when the first fails", async () => {
    let n = 0;
    const writer = fakeWriter({ tailorCv: () => (++n === 1 ? new Error("The model host is busy") : recordedTailoredCv) });
    const t = miraProfile({ writer });

    const pkg = await started(t);

    expect(pkg.parts[1]).toMatchObject({ state: "done", attempts: 2, error: null });
  });

  it("a part left being written when the app stopped shows as failed after a restart", async () => {
    const db = memoryDb();
    const { writer } = heldWriter();
    const t = miraProfile({ writer, db });
    const r = t.preparation.startPackage(kestrelJob());
    if (!r.started) throw new Error(r.reason);

    const after = createTestPreparation({ db }).preparation.package(r.package.id);

    expect(after).toMatchObject({ generating: false });
    expect(after!.parts[1]).toMatchObject({ state: "failed", error: "apply-kit stopped while this was being written" });
  });
});
