import { describe, expect, it, vi } from "vitest";
import type { CoachTurn, CoachTurnInput, PackageJob, PieceInput, TailoredCv, WriterRequest } from "../src/index.ts";
import { memoryDb } from "./harness.ts";
import { createTestPreparation, fakeRenderer, fakeWriter, recordedLetter, recordedTailoredCv } from "./preparation-harness.ts";

// Packages through the preparation engine (ticket #62): the Prepare button's states, starting a
// package, its parts and steps. Made-up people, companies and postings only.

/**
 * The recorded tailored CV with its placeholder ids ("piece-analyst") swapped for the profile's,
 * optionally edited the way a slipping model would write it.
 */
function recordedFor(ids: Record<string, string>, edit: (cv: TailoredCv) => void = () => {}): TailoredCv {
  const cv = JSON.parse(JSON.stringify(recordedTailoredCv).replace(/"piece-([a-z]+)"/g, (m, key: string) => (ids[key] ? JSON.stringify(ids[key]) : m))) as TailoredCv;
  edit(cv);
  return cv;
}

/** Mira Petrova's made-up master profile: one security role with results, a skill and a degree. */
function miraProfile(options: Parameters<typeof createTestPreparation>[0] & { tailor?: (cv: TailoredCv) => void; coach?: (input: CoachTurnInput, ids: Record<string, string>) => CoachTurn } = {}) {
  const ids: Record<string, string> = {};
  const { tailor, coach, ...rest } = options;
  const letter = () => JSON.parse(JSON.stringify(recordedLetter).replace(/"piece-([a-z]+)"/g, (m, key: string) => (ids[key] ? JSON.stringify(ids[key]) : m))) as typeof recordedLetter;
  const t = createTestPreparation({ writer: fakeWriter({ tailorCv: () => recordedFor(ids, tailor), writeLetter: letter, coachTurn: coach && ((input) => coach(input, ids)) }), ...rest });
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
  t.preparation.saveAngle({ angle: "security", summary: "Security analyst at a bank, writing detection rules." });
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

/** The CV's draft as the fake renderer printed it. */
async function printedCv(t: ReturnType<typeof miraProfile>, id: string): Promise<string> {
  return new TextDecoder().decode((await t.preparation.packageCv(id))!.pdf);
}

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
        // The CV's tailoring, the letter, and about three drafted screening answers.
        estimate: { costUsd: 0.01, seconds: 50 },
      },
    });
    if (!r.started) return;
    expect(r.package.parts.map((p) => [p.part, p.state])).toEqual([
      ["target", "done"], ["cv", "working"], ["letter", "working"], ["answers", "working"], ["ats", "waiting"],
    ]);
    expect(r.package.targetOptions).toEqual([
      { postingId: "posting-gh", site: "job-boards.greenhouse.io", url: "https://job-boards.greenhouse.io/kestrel/jobs/4410", recommended: true, consequence: "The company's own page. Your CV goes straight into their system and no account is needed." },
      { postingId: "posting-devbg", site: "dev.bg", url: "https://dev.bg/company/jobads/kestrel-security-engineer/", recommended: false, consequence: "A job board's copy. It may forward you to the company's form and mark you as coming from dev.bg. Pick it only if you want the board credited." },
    ]);
  });

  it("finishes as a ready package with the tailored CV printed, and its cost", async () => {
    const t = miraProfile();

    const pkg = await started(t);

    expect(pkg).toMatchObject({ generating: false, partsReady: 4, costUsd: 0.004, estimate: { costUsd: 0, seconds: 0 }, chip: { kind: "ready", label: "Package ready" } });
    expect(pkg.cv).toMatchObject({ fileName: "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf", pages: 1, overflow: null, language: "en", photo: false });
    const printed = await printedCv(t, pkg.id);
    expect(printed).toContain("Ran the incident response to a phishing campaign against the claims team");
    expect(printed).toContain("Wrote 30 detection rules that cut false alerts by a quarter");
    expect(printed).toContain("Northwind Bank");
    expect(printed).toContain("Wazuh");
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
      ["current", "Choose"], ["upcoming", "Drafted"], ["upcoming", "Drafted"], ["flagged", "3 need you"], ["upcoming", "After the CV"],
    ]);
  });

  it("lets later steps be read before they can be approved", async () => {
    const t = miraProfile();
    const pkg = await started(t);
    // The CV is readable (and downloadable as a draft) while step 1 still waits.
    expect(pkg.steps[1]).toMatchObject({ step: "cv", state: "upcoming", blocked: expect.stringContaining("Approve step 1") });
    expect(await t.preparation.packageCv(pkg.id)).not.toBeNull();
  });

  it("approves step 1, step 2 and the cover letter; the approved CV goes to the ATS check", async () => {
    const t = miraProfile();
    const pkg = await started(t);

    expect(t.preparation.approveStep(pkg.id, "target")).toMatchObject({ approved: true });
    const cv = t.preparation.approveStep(pkg.id, "cv");
    const letter = t.preparation.approveStep(pkg.id, "letter");

    expect(cv).toMatchObject({ approved: true });
    expect(letter).toMatchObject({ approved: true });
    expect(letter.package.steps.map((s) => [s.state, s.sub])).toEqual([
      // The default stand-in PDF is JSON, which a parser can't read as a CV.
      ["done", "Approved"], ["done", "Approved"], ["done", "Approved"], ["current", "3 need you"], ["flagged", "3 checks fail"],
    ]);
  });

  it("reopens the approved steps when the target posting or language changes", async () => {
    const t = miraProfile();
    const pkg = await started(t);
    t.preparation.approveStep(pkg.id, "target");
    t.preparation.approveStep(pkg.id, "cv");

    const changed = t.preparation.setTargetPosting(pkg.id, "posting-devbg");

    // The screening answers are written again from the new posting.
    expect(changed).toMatchObject({ changed: true, package: { targetPostingId: "posting-devbg", chip: { label: "Preparing package" } } });
    expect(await t.preparation.packageSettled(pkg.id)).toMatchObject({ chip: { label: "Continue package · step 1 of 5" } });
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
      ["target", "done"], ["cv", "stopped"], ["letter", "stopped"], ["answers", "stopped"], ["ats", "waiting"],
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
    expect(t.preparation.retryPart(r.package.id, "letter")).toMatchObject({ changed: true });
    t.preparation.retryPart(r.package.id, "answers");
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

describe("the tailored CV version (#63)", () => {
  it("prints the writer's lines in its order, every line linked to at least one piece", async () => {
    const t = miraProfile();

    const pkg = await started(t);

    const cv = pkg.cvVersion!;
    expect(cv.summary).toEqual({
      text: "Security analyst who writes SIEM detection rules and runs incident response at a bank.",
      pieces: [
        { id: t.ids.detections, label: "Wrote 30 detection rules that cut false alerts by a quarter." },
        { id: t.ids.phishing, label: "Ran the response to a phishing campaign against the claims team." },
      ],
    });
    expect(cv.roles).toEqual([{
      roleId: t.ids.analyst, heading: "Security Analyst · Northwind Bank, Sofia · Mar 2022 – present",
      bullets: [
        { text: "Ran the incident response to a phishing campaign against the claims team", pieces: [{ id: t.ids.phishing, label: "Ran the response to a phishing campaign against the claims team." }] },
        { text: "Wrote 30 detection rules that cut false alerts by a quarter", pieces: [{ id: t.ids.detections, label: "Wrote 30 detection rules that cut false alerts by a quarter." }] },
      ],
    }]);
    const lines = [cv.summary!, ...cv.roles.flatMap((r) => r.bullets), ...cv.skills, ...cv.education];
    expect(lines.length).toBe(5);
    for (const line of lines) expect(line.pieces.length).toBeGreaterThan(0);
  });

  it("lists every change from the master profile with what was, what is and why", async () => {
    const t = miraProfile();

    const pkg = await started(t);

    expect(pkg.cvVersion!.changes.map(({ label, was, is, detail, why, undone }) => ({ label, was, is, detail, why, undone }))).toEqual([
      {
        label: "Summary rewritten", was: "Security analyst at a bank, writing detection rules.",
        is: "Security analyst who writes SIEM detection rules and runs incident response at a bank.", detail: null,
        why: "Leads with SIEM work, the posting's first requirement.", undone: false,
      },
      {
        label: "Bullet reworded", was: "Ran the response to a phishing campaign against the claims team",
        is: "Ran the incident response to a phishing campaign against the claims team", detail: null,
        why: "The posting's term for the same work.", undone: false,
      },
      {
        label: "Bullet moved to the top", was: null, is: null,
        detail: "\"Ran the incident response to a phishing campaign against the claims team\" is now the first bullet under Northwind Bank.",
        why: "Incident response first: the posting asks for it by name.", undone: false,
      },
    ]);
  });

  it("never lets an invented employer, a changed date, a skill not in the profile or a number not in its pieces reach the CV", async () => {
    const t = miraProfile({
      tailor: (cv) => {
        cv.roles[0]!.start = "2020-03";
        cv.roles[0]!.bullets[1]!.text = "Wrote 45 detection rules in Splunk that cut false alerts by a quarter";
        cv.roles.push({ pieceId: "role-globex", title: "Threat Hunter", employer: "Globex Security", start: "2019-01", end: "2022-02", bullets: [], why: "" });
        cv.skills.push({ text: "Kubernetes", pieceIds: [] });
      },
    });

    const pkg = await started(t);

    const printed = await printedCv(t, pkg.id);
    for (const invented of ["Globex", "Threat Hunter", "2020", "Splunk", "45", "Kubernetes"]) expect(printed).not.toContain(invented);
    expect(printed).toContain("Wrote 30 detection rules that cut false alerts by a quarter.".replace(/\.$/, ""));
    expect(pkg.cvVersion!.honesty.slice(0, 4)).toEqual([
      { id: "roles", state: "fixed", label: "Employers, titles and dates match your master profile", detail: "The draft changed 2; the CV keeps your profile's." },
      { id: "skills", state: "fixed", label: "No skill that isn't in your profile", detail: "The draft named 2 that aren't; they were left out." },
      { id: "numbers", state: "fixed", label: "Every number traces to a piece with its source", detail: "The draft had 1 that didn't; your profile's wording is used." },
      { id: "citations", state: "ok", label: "Every line links to a piece in your profile", detail: null },
    ]);
    expect(pkg.cvVersion!.notes).toEqual(expect.arrayContaining([
      "The draft listed a role at Globex Security, which isn't in your profile. It was left out.",
      "Left \"Kubernetes\" off the skills: it isn't a skill in your profile.",
    ]));
  });

  it("maps each requirement to its evidence: the matcher's pieces, the ones the writer cited, and where they are on the CV", async () => {
    const t = miraProfile();
    const job = kestrelJob({ requirements: [
      { text: "Experience triaging alerts in a SIEM", kind: "required", category: "skill" },
      { text: "Incident response", kind: "required", category: "skill" },
      { text: "Kubernetes security", kind: "required", category: "skill" },
      { text: "CISSP", kind: "preferred", category: "certificate" },
    ] });

    const pkg = await started(t, job);

    expect(pkg.cvVersion!.evidence).toEqual([
      {
        requirement: "Experience triaging alerts in a SIEM", kind: "required", status: "partly",
        pieces: [{ id: t.ids.detections, label: "Wrote 30 detection rules that cut false alerts by a quarter." }, { id: t.ids.wazuh, label: "Wazuh" }],
        note: "Partly: no evidence for triaging", onCv: ["Summary", "Bullet 2 under Northwind Bank", "Skills"],
      },
      {
        requirement: "Incident response", kind: "required", status: "met",
        pieces: [{ id: t.ids.phishing, label: "Ran the response to a phishing campaign against the claims team." }],
        note: "", onCv: ["Summary", "Bullet 1 under Northwind Bank"],
      },
      { requirement: "Kubernetes security", kind: "required", status: "gap", pieces: [], note: "No evidence in your master profile", onCv: ["Not on the CV"] },
      { requirement: "CISSP", kind: "preferred", status: "not-held", pieces: [], note: expect.any(String), onCv: ["Left out, not claimed. Preferred items are never gaps."] },
    ]);
    expect(pkg.cvVersion!.honesty.slice(4)).toEqual([
      { id: "not-held:3", state: "ok", label: "CISSP left out, not claimed", detail: null },
      { id: "gap:2", state: "gap", label: "Gap: Kubernetes security, no evidence in your profile", detail: "Left off the CV." },
    ]);
  });

  it("has tailoring notes: the writer's, then the template's", async () => {
    const t = miraProfile();
    const pkg = await started(t);
    expect(pkg.cvVersion!.notes).toEqual([
      "Led with incident response and SIEM work, the two things the posting asks for.",
      "1 page, single column, Standard template, no photo.",
    ]);
  });
});

describe("undoing a change (#63)", () => {
  it("restores the previous line and prints the CV again; redo brings it back", async () => {
    const t = miraProfile();
    const pkg = await started(t);
    const reword = pkg.cvVersion!.changes.find((c) => c.label === "Bullet reworded")!;

    const undone = await t.preparation.undoCvChange(pkg.id, reword.id);

    expect(undone).toMatchObject({ changed: true });
    expect(undone.package.cvVersion!.changes.find((c) => c.id === reword.id)).toMatchObject({ undone: true });
    expect(undone.package.cv!.sha256).not.toBe(pkg.cv!.sha256);
    expect(undone.package.cvVersion!.roles[0]!.bullets[0]!.text).toBe("Ran the response to a phishing campaign against the claims team");
    expect(await printedCv(t, pkg.id)).not.toContain("Ran the incident response");

    const redone = await t.preparation.redoCvChange(pkg.id, reword.id);
    expect(redone.package.cvVersion!.roles[0]!.bullets[0]!.text).toBe("Ran the incident response to a phishing campaign against the claims team");
    expect(await printedCv(t, pkg.id)).toContain("Ran the incident response");
  });

  it("undoing a move puts the bullets back in the profile's order, and undoing the summary brings the angle's back", async () => {
    const t = miraProfile();
    const pkg = await started(t);
    const [summary, , move] = pkg.cvVersion!.changes;

    await t.preparation.undoCvChange(pkg.id, move!.id);
    const after = (await t.preparation.undoCvChange(pkg.id, summary!.id)).package;

    expect(after.cvVersion!.roles[0]!.bullets.map((b) => b.text)).toEqual([
      "Wrote 30 detection rules that cut false alerts by a quarter",
      "Ran the incident response to a phishing campaign against the claims team",
    ]);
    expect(after.cvVersion!.summary!.text).toBe("Security analyst at a bank, writing detection rules.");
  });

  it("reopens an approved CV step", async () => {
    const t = miraProfile();
    const pkg = await started(t);
    t.preparation.approveStep(pkg.id, "target");
    t.preparation.approveStep(pkg.id, "cv");

    const r = await t.preparation.undoCvChange(pkg.id, pkg.cvVersion!.changes[0]!.id);

    expect(r.package.steps[1]).toMatchObject({ state: "current", approvedAt: null });
  });

  it("refuses a change that isn't this package's", async () => {
    const t = miraProfile();
    const pkg = await started(t);
    expect(await t.preparation.undoCvChange(pkg.id, "change-nope")).toMatchObject({ changed: false, reason: "That change isn't in this CV version." });
  });
});

/** A renderer that fits `perPage` lines on a page: the title, the summary, then every bullet. */
function pagedRenderer(perPage: number) {
  return fakeRenderer((doc) => {
    const c = doc.content as { summary?: string; experience?: { bullets: string[] }[] };
    const lines = [doc.title, ...(c.summary ? [c.summary] : []), ...(c.experience ?? []).flatMap((r) => r.bullets)];
    const pages = [];
    for (let i = 0; i < lines.length; i += perPage) pages.push({ lines: lines.slice(i, i + perPage) });
    return { pages };
  });
}

/** Mira with an older internship and its bullet, printed four lines to a page: one line spills onto page 2. */
async function longCv() {
  const t = miraProfile({ renderer: pagedRenderer(4) });
  const save = (input: PieceInput) => { const r = t.preparation.savePiece(input); if (!r.saved) throw new Error(r.problems[0]!.message); return r.piece.id; };
  t.ids.intern = save({ kind: "role", text: "", entry: { title: "SOC Intern", organisation: "Varna Telecom", city: "Varna", start: "2021-06", end: "2021-09" }, angles: ["security"] });
  t.ids.scripts = save({ kind: "achievement", text: "Wrote Python scripts to enrich alerts with owner data.", belongsTo: t.ids.intern, angles: ["security"] });
  return { t, pkg: await started(t) };
}

describe("a CV that runs onto a second page (#63)", () => {
  it("reports the lines on page 2 with ways to tighten it, and Approve waits for a choice", async () => {
    const { t, pkg } = await longCv();

    expect(pkg.cvVersion!.fit).toEqual({
      pages: 2, linesOnPage2: 1, keepTwoPages: false,
      choices: [
        { id: `shorten-role:${t.ids.intern}`, label: "Shorten the SOC Intern role to its title and dates", meta: "Saves about 1 line. Least relevant to this posting." },
        { id: `drop-bullet:${t.ids.detections}`, label: "Leave out the last bullet under Northwind Bank", meta: "Saves about 1 line: \"Wrote 30 detection rules that cut false alerts by a quarter\"." },
        { id: "keep-two-pages", label: "Keep 2 pages", meta: "Some recruiters skip page 2. The ATS check will say so." },
      ],
    });
    t.preparation.approveStep(pkg.id, "target");
    expect(t.preparation.approveStep(pkg.id, "cv")).toMatchObject({ approved: false, blockedBy: "cv", reason: "This CV runs onto 2 pages. Choose how to fit one page, or keep 2." });
  });

  it("a tightening choice is an undoable change that brings it back to one page", async () => {
    const { t, pkg } = await longCv();

    const r = await t.preparation.fitCv(pkg.id, `shorten-role:${t.ids.intern}`);

    expect(r).toMatchObject({ changed: true, package: { cv: { pages: 1, overflow: null }, cvVersion: { fit: { pages: 1, linesOnPage2: 0, choices: [] } } } });
    const change = r.package.cvVersion!.changes.at(-1)!;
    expect(change).toMatchObject({ label: "SOC Intern role shortened to its title and dates", detail: "1 bullet → 0. The role and dates stay.", why: "To fit one page: least relevant to this posting.", origin: "tightening" });
    t.preparation.approveStep(pkg.id, "target");
    expect(t.preparation.approveStep(pkg.id, "cv")).toMatchObject({ approved: true });

    const undone = await t.preparation.undoCvChange(pkg.id, change.id);
    expect(undone.package.cv).toMatchObject({ pages: 2 });
    expect(undone.package.steps[1]).toMatchObject({ approvedAt: null, blocked: "This CV runs onto 2 pages. Choose how to fit one page, or keep 2." });
  });

  it("Keep 2 pages is a choice too", async () => {
    const { t, pkg } = await longCv();

    const r = await t.preparation.fitCv(pkg.id, "keep-two-pages");

    expect(r).toMatchObject({ changed: true, package: { cv: { pages: 2 }, cvVersion: { fit: { keepTwoPages: true, choices: [] } } } });
    t.preparation.approveStep(pkg.id, "target");
    expect(t.preparation.approveStep(pkg.id, "cv")).toMatchObject({ approved: true });

    // Changing her mind brings the choices back and reopens the step.
    const again = await t.preparation.fitCv(pkg.id, "choose-again");
    expect(again.package.cvVersion!.fit).toMatchObject({ keepTwoPages: false, choices: expect.arrayContaining([expect.objectContaining({ id: "keep-two-pages" })]) });
    expect(again.package.steps[1]).toMatchObject({ approvedAt: null });
  });

  it("refuses a choice that isn't offered", async () => {
    const { t, pkg } = await longCv();
    expect(await t.preparation.fitCv(pkg.id, "shrink-font")).toMatchObject({ changed: false, reason: "That isn't one of the ways offered to fit this CV on one page." });
  });
});

/** The writer words the detections bullet more strongly than its piece, with an honest wording beside it. */
const strongerDetections = (cv: TailoredCv) => {
  Object.assign(cv.roles[0]!.bullets[1]!, {
    text: "Led detection engineering: 30 rules that cut false alerts by a quarter",
    claim: "stronger",
    honest: "Wrote 30 SIEM detection rules that cut false alerts by a quarter",
    why: "The posting asks for a lead.",
  });
};

describe("near-the-line flags (#64)", () => {
  it("a stronger line is a flag inside its requirement: the profile's wording stays, the stronger one is never offered, nothing is pre-selected", async () => {
    const t = miraProfile({ tailor: strongerDetections });

    const pkg = await started(t);

    expect(pkg.cvVersion!.flags).toEqual([{
      id: expect.any(String), kind: "near-the-line", requirement: 0,
      title: "Wording for \"Wrote 30 detection rules that cut false alerts by a quarter\"",
      heading: "The draft words this more strongly than your profile backs.",
      detail: "Your profile says \"Wrote 30 detection rules that cut false alerts by a quarter.\" Pick the wording you'd defend in an interview.",
      piece: "Wrote 30 detection rules that cut false alerts by a quarter.",
      draft: "Led detection engineering: 30 rules that cut false alerts by a quarter",
      options: [
        { id: "profile", label: "Wrote 30 detection rules that cut false alerts by a quarter", holdsUp: "Exactly your profile. Holds up to any question." },
        { id: "honest", label: "Wrote 30 SIEM detection rules that cut false alerts by a quarter", holdsUp: "Says only what your profile backs, in the posting's words. Holds up." },
      ],
      ownWording: true,
      notOffered: "\"Led detection engineering: 30 rules that cut false alerts by a quarter\" isn't offered: it claims more than your profile backs.",
      question: null,
      answer: null,
      decision: null,
    }]);
    const printed = await printedCv(t, pkg.id);
    expect(printed).not.toContain("Led detection engineering");
    expect(printed).toContain("Wrote 30 detection rules that cut false alerts by a quarter");
  });

  it("a step with an open flag can't be approved, and says which flag; deciding it enables Approve", async () => {
    const t = miraProfile({ tailor: strongerDetections });
    const pkg = await started(t);
    const flag = pkg.cvVersion!.flags[0]!;
    t.preparation.approveStep(pkg.id, "target");

    const blocked = t.preparation.approveStep(pkg.id, "cv");
    expect(blocked).toMatchObject({
      approved: false, blockedBy: "cv", flagId: flag.id,
      reason: "The CV can't be approved yet: 1 flag is still open. The draft words \"Wrote 30 detection rules that cut false alerts by a quarter\" more strongly than your profile backs. Pick a wording you can defend in an interview.",
    });
    expect(blocked.package.steps[1]).toMatchObject({ state: "current", sub: "1 flag" });

    const r = await t.preparation.decideFlag(pkg.id, flag.id, { option: "honest" });

    expect(r).toMatchObject({ changed: true });
    expect(r.package.cvVersion!.flags[0]!.decision).toEqual({
      option: "honest", label: "Used \"Wrote 30 SIEM detection rules that cut false alerts by a quarter\"", text: "Wrote 30 SIEM detection rules that cut false alerts by a quarter", at: "2026-10-12T07:30:00.000Z",
    });
    expect(r.package.steps[1]).toMatchObject({ state: "current", sub: "Flags decided" });
    expect(await printedCv(t, pkg.id)).toContain("Wrote 30 SIEM detection rules that cut false alerts by a quarter");
    expect(t.preparation.approveStep(pkg.id, "cv")).toMatchObject({ approved: true });
  });

  it("Kris's own wording is checked against the profile before it's used", async () => {
    const t = miraProfile({ tailor: strongerDetections });
    const pkg = await started(t);
    const flag = pkg.cvVersion!.flags[0]!;

    expect(await t.preparation.decideFlag(pkg.id, flag.id, { own: "Wrote 50 detection rules in Splunk" })).toMatchObject({
      changed: false, reason: "That wording can't be used: it names \"Splunk\", which isn't in your profile; it says \"50\", which its piece doesn't back.",
    });
    expect(await t.preparation.decideFlag(pkg.id, flag.id, { own: "Led detection engineering: 30 rules that cut false alerts by a quarter" })).toMatchObject({
      changed: false, reason: "That's the wording that claims more than your profile backs. Choose another.",
    });

    const r = await t.preparation.decideFlag(pkg.id, flag.id, { own: "Wrote 30 Wazuh detection rules, cutting false alerts by a quarter" });
    expect(r.package.cvVersion!.flags[0]!.decision).toMatchObject({ option: "own", label: "Your own wording: \"Wrote 30 Wazuh detection rules, cutting false alerts by a quarter\"" });
    expect(r.package.cvVersion!.roles[0]!.bullets[1]!.text).toBe("Wrote 30 Wazuh detection rules, cutting false alerts by a quarter");
  });

  it("a decision can be changed; it reopens an approved CV step, and its change is undone only through the flag", async () => {
    const t = miraProfile({ tailor: strongerDetections });
    const pkg = await started(t);
    const flag = pkg.cvVersion!.flags[0]!;
    const first = await t.preparation.decideFlag(pkg.id, flag.id, { option: "honest" });
    t.preparation.approveStep(pkg.id, "target");
    t.preparation.approveStep(pkg.id, "cv");
    const change = first.package.cvVersion!.changes.find((c) => c.flagId === flag.id)!;
    expect(change).toMatchObject({ origin: "decision", label: "Bullet reworded, as you decided", was: "Wrote 30 detection rules that cut false alerts by a quarter", is: "Wrote 30 SIEM detection rules that cut false alerts by a quarter" });
    expect(await t.preparation.undoCvChange(pkg.id, change.id)).toMatchObject({ changed: false, reason: "This change is a decision on a flag: change it there." });

    const r = await t.preparation.decideFlag(pkg.id, flag.id, { option: "profile" });

    expect(r.package.steps[1]).toMatchObject({ approvedAt: null });
    expect(r.package.cvVersion!.changes.some((c) => c.flagId === flag.id)).toBe(false);
    expect(r.package.cvVersion!.roles[0]!.bullets[1]!.text).toBe("Wrote 30 detection rules that cut false alerts by a quarter");
    expect(r.package.cvVersion!.decisions).toEqual([{ flagId: flag.id, title: flag.title, decision: "Kept your profile's wording", at: "2026-10-12T07:30:00.000Z" }]);
  });

  it("refuses an option that isn't offered", async () => {
    const t = miraProfile({ tailor: strongerDetections });
    const pkg = await started(t);
    expect(await t.preparation.decideFlag(pkg.id, pkg.cvVersion!.flags[0]!.id, { option: "stronger" })).toMatchObject({ changed: false, reason: "That isn't one of this flag's options." });
    expect(await t.preparation.decideFlag(pkg.id, "flag-nope", { option: "profile" })).toMatchObject({ changed: false, reason: "That flag isn't in this CV version." });
  });

  it("the honesty summary counts the near-the-line edit while it's open", async () => {
    const t = miraProfile({ tailor: strongerDetections });
    const pkg = await started(t);
    expect(pkg.cvVersion!.honesty.find((c) => c.state === "line")).toEqual({
      id: `flag:${pkg.cvVersion!.flags[0]!.id}`, state: "line", label: "Near-the-line edit: \"Led detection engineering: 30 rules that cut false alerts…\"", detail: "Decide it above.",
    });
  });
});

/** Kestrel's posting asking for Kubernetes security, which Mira's profile has no evidence for, and a preferred CISSP. */
const kubernetesJob = (overrides: Partial<PackageJob> = {}) => kestrelJob({
  requirements: [
    { text: "Incident response", kind: "required", category: "skill" },
    { text: "Kubernetes security", kind: "required", category: "skill" },
    { text: "CISSP", kind: "preferred", category: "certificate" },
  ],
  ...overrides,
});

const kubernetesAnswer = "At Northwind I locked down our Kubernetes test cluster with network policies, once.";

/** The coach writes one achievement under the analyst role from Kris's answer (`text` is its wording). */
const coachWrites = (text = "Locked down a Kubernetes test cluster with network policies", claim: "as-said" | "stronger" = "as-said", honest: string | null = null) =>
  (input: CoachTurnInput, ids: Record<string, string>): CoachTurn => ({
    reply: "Thanks, I'll write that down.", ask: "", followUp: false, answer: null,
    pieces: [{
      turn: input.asked!.lines.at(-1)!.id, updates: null, kind: "achievement", text, entry: null, role: ids.analyst!, tags: ["Kubernetes"],
      angles: ["security"], numberSource: null, claim, honest,
    }],
  });

/** What the writer was asked to tailor from, for the last CV it wrote. */
const lastTailorInput = (t: ReturnType<typeof miraProfile>) => {
  const calls = (t.writer as unknown as { calls: WriterRequest[] }).calls.filter((c) => c.task === "tailor-cv");
  return calls.at(-1)!.input as { pieces: { id: string }[] };
};

describe("gap flags and gap questions (#64)", () => {
  it("a required item with no evidence is a gap flag with three options, none pre-selected; a preferred one is never a gap", async () => {
    const t = miraProfile();

    const pkg = await started(t, kubernetesJob());

    expect(pkg.cvVersion!.flags).toEqual([{
      id: expect.any(String), kind: "gap", requirement: 1,
      title: "Kubernetes security gap",
      heading: "Kubernetes security is required and your profile has no evidence for it.",
      detail: "Gaps are never covered up: it stays off the CV unless you have real experience to add.",
      piece: null, draft: null, notOffered: null, ownWording: false, answer: null, decision: null,
      options: [
        { id: "letter", label: "Name it in the cover letter as something to learn", holdsUp: "One honest sentence; interviewers tend to ask about a gap anyway." },
        { id: "leave-out", label: "Leave it out of both", holdsUp: "The CV and letter don't mention it. You'll likely be asked in the interview." },
        { id: "experience", label: "I have experience the profile doesn't know about", holdsUp: expect.stringContaining("comes back here as a flag for you to approve") },
      ],
      question: { text: "What did you do with Kubernetes security?", help: "Where, when and what you did. \"Once, in a side project\" is a fine answer." },
    }]);
  });

  it("naming the gap in the letter decides it, and the decision carries into the package's decisions", async () => {
    const t = miraProfile();
    const pkg = await started(t, kubernetesJob());
    const gap = pkg.cvVersion!.flags[0]!;
    t.preparation.approveStep(pkg.id, "target");
    expect(t.preparation.approveStep(pkg.id, "cv")).toMatchObject({
      approved: false, flagId: gap.id, reason: "The CV can't be approved yet: 1 flag is still open. Kubernetes security has no evidence in your profile. Choose how to handle the gap.",
    });

    const r = await t.preparation.decideFlag(pkg.id, gap.id, { option: "letter" });

    expect(r.package.cvVersion!.decisions).toEqual([{ flagId: gap.id, title: "Kubernetes security gap", decision: "Named in the cover letter as something to learn", at: expect.any(String) }]);
    expect(r.package.cvVersion!.honesty.find((c) => c.id === "gap:1")).toMatchObject({ detail: "Left off the CV. You chose: named in the cover letter as something to learn." });
    expect(t.preparation.approveStep(pkg.id, "cv")).toMatchObject({ approved: true });
  });

  it("a gap answer becomes an unconfirmed piece for this package, and its line comes back as a new flag before the CV changes", async () => {
    const t = miraProfile({ coach: coachWrites() });
    const pkg = await started(t, kubernetesJob());
    const gap = pkg.cvVersion!.flags[0]!;
    const before = await printedCv(t, pkg.id);

    const r = await t.preparation.answerGap(pkg.id, gap.id, kubernetesAnswer);

    expect(r).toMatchObject({ changed: true });
    const coachCall = (t.writer as unknown as { calls: WriterRequest[] }).calls.find((c) => c.task === "coach-turn")!;
    expect(coachCall.input).toMatchObject({ asked: { topic: { kind: "skill", skill: "Kubernetes security" }, lines: [{ who: "coach", text: "What did you do with Kubernetes security?" }, { who: "you", text: kubernetesAnswer }] }, next: null });
    const [decided, learned] = r.package.cvVersion!.flags;
    expect(decided).toMatchObject({ id: gap.id, answer: kubernetesAnswer, decision: { option: "experience", label: `Told the coach: "${kubernetesAnswer.slice(0, 57).replace(/ \S*$/, "")}…"` } });
    expect(learned).toMatchObject({
      kind: "learned", requirement: 1, title: "New line for Kubernetes security", decision: null, ownWording: true,
      options: [
        { id: "use", label: "Locked down a Kubernetes test cluster with network policies", holdsUp: expect.any(String) },
        { id: "leave-out", label: "Don't use it on this CV", holdsUp: expect.any(String) },
      ],
    });
    // The CV hasn't changed: the line waits for Kris's decision, and the step can't be approved.
    expect(await printedCv(t, pkg.id)).toBe(before);
    t.preparation.approveStep(pkg.id, "target");
    expect(t.preparation.approveStep(pkg.id, "cv")).toMatchObject({ approved: false, flagId: learned!.id });
    // The piece waits in Profile, unconfirmed, with the question and Kris's own answer.
    expect(t.preparation.learnedPieces()).toEqual([{
      piece: expect.objectContaining({ text: "Locked down a Kubernetes test cluster with network policies", status: "unconfirmed", source: { from: "Kestrel Payments package", quote: kubernetesAnswer } }),
      under: "Northwind Bank", packageId: pkg.id, jobId: "job-kestrel", job: "Security Engineer at Kestrel Payments", company: "Kestrel Payments",
      question: "What did you do with Kubernetes security?", answer: kubernetesAnswer, learnedAt: expect.any(String), nearTheLine: null,
    }]);
    expect(t.preparation.profileSummary()).toMatchObject({ learned: 1 });
  });

  it("using the line adds it to this CV; the piece stays out of every other package until it's confirmed in Profile", async () => {
    const t = miraProfile({ coach: coachWrites() });
    const pkg = await started(t, kubernetesJob());
    const r0 = await t.preparation.answerGap(pkg.id, pkg.cvVersion!.flags[0]!.id, kubernetesAnswer);
    const learned = r0.package.cvVersion!.flags[1]!;

    const r = await t.preparation.decideFlag(pkg.id, learned.id, { option: "use" });

    expect(r.package.cvVersion!.roles[0]!.bullets.map((b) => b.text)).toContain("Locked down a Kubernetes test cluster with network policies");
    expect(await printedCv(t, pkg.id)).toContain("Locked down a Kubernetes test cluster with network policies");
    expect(r.package.cvVersion!.changes.at(-1)).toMatchObject({ origin: "decision", label: "Bullet added from your answer", flagId: learned.id });
    const pieceId = t.preparation.learnedPieces()[0]!.piece.id;
    expect(r.package.cvVersion!.evidence[1]!.pieces.map((p) => p.id)).toContain(pieceId);

    // Another job's package can't use it while it's unconfirmed.
    await started(t, kubernetesJob({ id: "job-halden", company: "Halden Systems" }));
    expect(lastTailorInput(t).pieces.map((p) => p.id)).not.toContain(pieceId);

    // Confirmed in Profile, it's in the master profile for the next package.
    expect(t.preparation.confirmPiece(pieceId)).toMatchObject({ saved: true });
    expect(t.preparation.learnedPieces()).toEqual([]);
    const next = await started(t, kubernetesJob({ id: "job-orbital", company: "Orbital Pay" }));
    expect(lastTailorInput(t).pieces.map((p) => p.id)).toContain(pieceId);
    expect(next.cvVersion!.flags.some((f) => f.kind === "gap")).toBe(false);
  });

  it("discarding a learned piece in Profile never changes the package it was used in", async () => {
    const t = miraProfile({ coach: coachWrites() });
    const pkg = await started(t, kubernetesJob());
    const r0 = await t.preparation.answerGap(pkg.id, pkg.cvVersion!.flags[0]!.id, kubernetesAnswer);
    await t.preparation.decideFlag(pkg.id, r0.package.cvVersion!.flags[1]!.id, { option: "use" });
    const printed = await printedCv(t, pkg.id);

    t.preparation.discardPiece(t.preparation.learnedPieces()[0]!.piece.id);

    expect(await printedCv(t, pkg.id)).toBe(printed);
    expect(t.preparation.package(pkg.id)!.cvVersion!.roles[0]!.bullets.map((b) => b.text)).toContain("Locked down a Kubernetes test cluster with network policies");
    expect(t.preparation.learnedPieces()).toEqual([]);
  });

  it("deciding the gap another way drops the line from the answer; the piece still waits in Profile", async () => {
    const t = miraProfile({ coach: coachWrites() });
    const pkg = await started(t, kubernetesJob());
    const gap = pkg.cvVersion!.flags[0]!;
    const r0 = await t.preparation.answerGap(pkg.id, gap.id, kubernetesAnswer);
    await t.preparation.decideFlag(pkg.id, r0.package.cvVersion!.flags[1]!.id, { option: "use" });

    const r = await t.preparation.decideFlag(pkg.id, gap.id, { option: "leave-out" });

    expect(r.package.cvVersion!.flags.map((f) => f.kind)).toEqual(["gap"]);
    expect(await printedCv(t, pkg.id)).not.toContain("Kubernetes test cluster");
    expect(t.preparation.learnedPieces()).toHaveLength(1);
  });

  it("answering again replaces the line from the earlier answer; both pieces still wait in Profile", async () => {
    const t = miraProfile({
      coach: (input, ids) => /k3s/.test(input.asked!.lines.at(-1)!.text)
        ? { reply: "", ask: "", followUp: false, answer: null, pieces: [{ turn: input.asked!.lines.at(-1)!.id, updates: null, kind: "skill", text: "Kubernetes", entry: null, role: null, tags: [], angles: ["security"], numberSource: null, claim: "stronger", honest: "Learning: Kubernetes (k3s)" }] }
        : coachWrites()(input, ids),
    });
    const pkg = await started(t, kubernetesJob());
    const gap = pkg.cvVersion!.flags[0]!;
    await t.preparation.answerGap(pkg.id, gap.id, "I played with k3s once.");

    const r = await t.preparation.answerGap(pkg.id, gap.id, "At Northwind I locked down our Kubernetes test cluster with network policies.");

    expect(r.package.cvVersion!.flags.map((f) => f.kind)).toEqual(["gap", "learned"]);
    expect(t.preparation.learnedPieces()).toHaveLength(2);
  });

  it("an answer the coach couldn't write a line from leaves the gap open", async () => {
    const t = miraProfile({ coach: () => ({ reply: "", ask: "", followUp: false, answer: null, pieces: [] }) });
    const pkg = await started(t, kubernetesJob());
    const gap = pkg.cvVersion!.flags[0]!;
    expect(await t.preparation.answerGap(pkg.id, gap.id, "  ")).toMatchObject({ changed: false, reason: "Say what you did first. A short answer is fine." });

    const r = await t.preparation.answerGap(pkg.id, gap.id, "Not really, I read about it.");

    expect(r).toMatchObject({ changed: false, reason: "The coach couldn't write a line from that answer that keeps to your words. Add where and what you did, or choose another option." });
    expect(r.package.cvVersion!.flags).toEqual([expect.objectContaining({ id: gap.id, answer: "Not really, I read about it.", decision: null })]);
  });
});

describe("Profile › Learned during packages (#64)", () => {
  /** The coach words Mira's answer more strongly than she did, with the wording that keeps to it. */
  async function nearTheLineAnswer() {
    const t = miraProfile({ coach: coachWrites("Led the hardening of the bank's Kubernetes clusters", "stronger", "Locked down a Kubernetes test cluster with network policies") });
    const pkg = await started(t, kubernetesJob());
    const r = await t.preparation.answerGap(pkg.id, pkg.cvVersion!.flags[0]!.id, kubernetesAnswer);
    return { t, pkg: r.package };
  }

  it("a learned piece that says more than the answer is flagged, with the honest version offered and the stronger one never", async () => {
    const { t, pkg } = await nearTheLineAnswer();

    expect(pkg.cvVersion!.flags[1]).toMatchObject({
      kind: "learned",
      options: [{ id: "use", label: "Locked down a Kubernetes test cluster with network policies" }, { id: "leave-out" }],
      notOffered: "\"Led the hardening of the bank's Kubernetes clusters\" isn't offered: it says more than your answer did.",
    });
    expect(t.preparation.learnedPieces()[0]).toMatchObject({
      piece: { status: "flagged", text: "Led the hardening of the bank's Kubernetes clusters" },
      nearTheLine: { honest: "Locked down a Kubernetes test cluster with network policies", stronger: "Led the hardening of the bank's Kubernetes clusters" },
    });
  });

  it("is never bulk-confirmed; keeping its honest version confirms it", async () => {
    const { t } = await nearTheLineAnswer();
    const pieceId = t.preparation.learnedPieces()[0]!.piece.id;

    expect(t.preparation.confirmLearnedPieces()).toEqual({ confirmed: 0, refused: [] });
    expect(t.preparation.piece(pieceId)).toMatchObject({ status: "flagged" });

    expect(t.preparation.keepHonestVersion(pieceId)).toMatchObject({ saved: true, piece: { status: "confirmed", text: "Locked down a Kubernetes test cluster with network policies" } });
    expect(t.preparation.learnedPieces()).toEqual([]);
  });

  it("Confirm the unflagged confirms the others in one go", async () => {
    const t = miraProfile({ coach: coachWrites() });
    const pkg = await started(t, kubernetesJob());
    await t.preparation.answerGap(pkg.id, pkg.cvVersion!.flags[0]!.id, kubernetesAnswer);

    expect(t.preparation.confirmLearnedPieces()).toEqual({ confirmed: 1, refused: [] });
    expect(t.preparation.learnedPieces()).toEqual([]);
    expect(t.preparation.profileSummary()).toMatchObject({ learned: 0 });
  });
});

describe("a learned skill near the line (#64)", () => {
  it("prints the honest wording Kris chose, never the stronger one", async () => {
    const t = miraProfile({
      coach: (input) => ({
        reply: "", ask: "", followUp: false, answer: null,
        pieces: [{ turn: input.asked!.lines.at(-1)!.id, updates: null, kind: "skill", text: "Kubernetes", entry: null, role: null, tags: [], angles: ["security"], numberSource: null, claim: "stronger", honest: "Learning: Kubernetes (k3s, one personal project)" }],
      }),
    });
    const pkg = await started(t, kubernetesJob());
    const r0 = await t.preparation.answerGap(pkg.id, pkg.cvVersion!.flags[0]!.id, "I played with k3s once for a side project.");
    const learned = r0.package.cvVersion!.flags[1]!;
    expect(learned.options[0]).toMatchObject({ id: "use", label: "Learning: Kubernetes (k3s, one personal project)" });

    const r = await t.preparation.decideFlag(pkg.id, learned.id, { option: "use" });

    expect(r.package.cvVersion!.skills.map((s) => s.text)).toEqual(["Wazuh", "Learning: Kubernetes (k3s, one personal project)"]);
    const printed = await printedCv(t, pkg.id);
    expect(printed).toContain("Learning: Kubernetes (k3s, one personal project)");
    expect(printed).not.toMatch(/"Kubernetes"/);
  });
});
