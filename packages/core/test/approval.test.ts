import { describe, expect, it } from "vitest";
import { approved, kestrelJob, mira, started, upToAts } from "./package-fixtures.ts";
import { memoryPackageFolder } from "./preparation-harness.ts";

// Step 5 and the finish (ticket #67), through the preparation engine: the ATS check of the CV's
// PDF, approving the package (files frozen by SHA-256), reopening, a profile change to a draft, and
// the contracts Apply and Track read. Made-up people, companies and postings only.

describe("the ATS check (step 5)", () => {
  it("reads the approved CV's PDF the way a parser does: the text in reading order, pass or fail per check, no score", async () => {
    const t = mira();
    const pkg = await upToAts(t);

    expect(pkg.parts[4]).toMatchObject({ part: "ats", state: "done" });
    expect(pkg.steps[4]).toMatchObject({ step: "ats", state: "current", blocked: null });
    expect(pkg.ats!.passing).toBe(pkg.ats!.checks.length);
    expect(pkg.ats!.checks.map((c) => [c.check, c.passed])).toContainEqual(["keywords", true]);
    expect(pkg.ats!.lines.slice(0, 3).map((l) => l.text)).toEqual([
      "Mira Petrova", "Security Analyst", "Sofia, Bulgaria · mira.petrova@example.com · +359 88 000 0175 · www.linkedin.com/in/mira-petrova-example",
    ]);
    expect(pkg.ats!.lines.every((l) => l.lost === null)).toBe(true);
  });
});

describe("posting keywords", () => {
  it("are the skills and certificates the posting names; a longer requirement is a description, not a keyword", async () => {
    const t = mira();
    const pkg = await upToAts(t, kestrelJob({ requirements: [{ text: "Experience triaging alerts in a SIEM", category: "skill" }, { text: "Incident response", category: "skill" }] }));

    expect(pkg.ats!.checks.find((c) => c.check === "keywords")).toMatchObject({ passed: true, problems: [], notes: [] });
  });
});

describe("the ATS check's fix", () => {
  it("asks for the missing fact; ticked, it updates the master profile and the check runs again", async () => {
    const t = mira({ phone: "" });
    const pkg = await upToAts(t);
    expect(pkg.ats!.checks.find((c) => c.check === "contact")).toMatchObject({ passed: false, problems: ["No phone number on the CV"] });
    expect(pkg.ats!.lost).toEqual(["No phone number on the CV"]);
    expect(pkg.ats!.fixes).toEqual([{
      id: "contact", title: "Add your phone number",
      detail: "Parsers fill a portal's contact fields from the CV, and your profile doesn't have this yet. Nothing is guessed: give the real one.",
      fields: [{ field: "phone", label: "Phone, with the country code" }],
    }]);

    const fixed = await t.preparation.fixAts(pkg.id, { values: { phone: "+359 88 000 0175" }, updateProfile: true });

    expect(fixed).toMatchObject({ changed: true });
    expect(t.preparation.contact().phone).toBe("+359 88 000 0175");
    expect(fixed.package.ats!.checks.find((c) => c.check === "contact")).toMatchObject({ passed: true });
    expect(fixed.package.ats!.fixes).toEqual([]);
    expect(fixed.package.cv!.sha256).not.toBe(pkg.cv!.sha256);
    // The CV stays approved: the new detail is a fact, not a change to its words.
    expect(fixed.package.steps.map((s) => s.approvedAt !== null)).toEqual([true, true, true, true, false]);
  });

  it("unticked, the fact is used in this package only", async () => {
    const t = mira({ phone: "" });
    const pkg = await upToAts(t);

    const fixed = await t.preparation.fixAts(pkg.id, { values: { phone: "+359 88 000 0175" }, updateProfile: false });

    expect(t.preparation.contact().phone).toBe("");
    expect(fixed.package.ats!.checks.find((c) => c.check === "contact")).toMatchObject({ passed: true });
  });

  it("refuses an empty answer: nothing is guessed", async () => {
    const t = mira({ phone: "" });
    const pkg = await upToAts(t);

    expect(await t.preparation.fixAts(pkg.id, { values: { phone: " " }, updateProfile: true })).toMatchObject({ changed: false, reason: "Give your phone number, with the country code." });
  });
});

describe("approving the package", () => {
  it("waits while a check fails, naming it, until Kris accepts the failing check knowingly", async () => {
    const t = mira();
    // Python is in the profile, but only on the developer angle: this security CV doesn't print it.
    t.preparation.savePiece({ kind: "skill", text: "Python", tags: ["scripting"], angles: ["developer"] });
    const pkg = await upToAts(t, kestrelJob({ requirements: [{ text: "Incident response" }, { text: "Python", category: "skill" }] }));

    expect(pkg.ats!.checks.find((c) => c.check === "keywords")).toMatchObject({ passed: false, problems: ["Posting keyword not found: Python"] });
    expect(pkg.steps[4]).toMatchObject({ state: "current", sub: "1 check fails", blocked: "1 check fails: posting keywords found. Fix it, or approve knowing it fails." });
    const refused = await t.preparation.approvePackage(pkg.id);
    expect(refused).toMatchObject({ approved: false, blockedBy: "ats", reason: "1 check fails: posting keywords found. Fix it, or approve knowing it fails." });

    const approved = await t.preparation.approvePackage(pkg.id, { acceptFailingChecks: true });

    expect(approved).toMatchObject({ approved: true, package: { ats: { accepted: ["keywords"] }, chip: { kind: "ready", label: "Package ready" } } });
    expect(approved.package.steps.every((s) => s.approvedAt !== null)).toBe(true);
  });

  it("counts a gap Kris chose to leave out as a deliberate pass, with the reason", async () => {
    const t = mira();
    const job = kestrelJob({ requirements: [{ text: "Incident response" }, { text: "Kubernetes", category: "skill" }] });
    const pkg = await started(t, job);
    const gap = pkg.cvVersion!.flags.find((f) => f.kind === "gap")!;
    await t.preparation.decideFlag(pkg.id, gap.id, { option: "leave-out" });

    const ready = await upToAts(t, job);

    expect(ready.ats!.checks.find((c) => c.check === "keywords")).toMatchObject({ passed: true, notes: ["Kubernetes: a gap you chose to leave out"] });
    expect(await t.preparation.approvePackage(ready.id)).toMatchObject({ approved: true });
  });
});

describe("frozen files", () => {
  it("freezes the CV and letter PDFs by SHA-256 as version 1, copied to the Packages folder", async () => {
    const folder = memoryPackageFolder();
    const t = mira({ packages: folder });

    const pkg = await approved(t);

    const cv = pkg.approved!.cv.file;
    expect(pkg.approved).toMatchObject({ version: 1, state: "approved", approvedAt: "2026-10-12T07:30:00.000Z" });
    expect(cv).toMatchObject({
      fileName: "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf", sha256: pkg.cv!.sha256, size: pkg.cv!.size,
      path: `packages/${pkg.id}/v1/Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf`, copy: "Packages/Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf",
    });
    expect(pkg.approved!.letter!.file).toMatchObject({ fileName: "Mira_Petrova_Cover_Letter_Kestrel_Payments_Security_Engineer.pdf", path: `packages/${pkg.id}/v1/Mira_Petrova_Cover_Letter_Kestrel_Payments_Security_Engineer.pdf` });
    expect(folder.files.get(cv.path)).toEqual(await t.preparation.packageCv(pkg.id).then((f) => f!.pdf));
  });

  it("an approved CV file's hash never changes: editing a part reopens it as a new draft that needs approval", async () => {
    const t = mira();
    const pkg = await approved(t);
    const frozen = pkg.approved!.cv.file;
    const change = pkg.cvVersion!.changes.find((c) => !c.flagId)!;

    const edited = await t.preparation.undoCvChange(pkg.id, change.id);

    expect(edited.package.approved).toBeNull();
    expect(edited.package.steps.map((s) => s.approvedAt !== null)).toEqual([true, false, false, false, false]);
    expect(edited.package.cv!.sha256).not.toBe(frozen.sha256);
    expect(edited.package.chip).toMatchObject({ kind: "continue", label: "Continue package · step 2 of 5" });

    // Approved again, it's version 2; version 1's file is as it was.
    for (const step of ["cv", "letter", "answers"] as const) t.preparation.approveStep(pkg.id, step);
    const again = await t.preparation.approvePackage(pkg.id);
    expect(again).toMatchObject({ approved: true, package: { approved: { version: 2 } } });
    expect(again.package.approved!.cv.file.sha256).toBe(edited.package.cv!.sha256);
    expect(await t.preparation.packageFile(pkg.id, "cv", 1)).toMatchObject({ sha256: frozen.sha256 });
  });
});

describe("what Apply reads (#38, #39, #41)", () => {
  it("a draft package answers 'not approved yet'; a job without one answers none", async () => {
    const t = mira();
    const pkg = await started(t);

    expect(t.preparation.packageForApply({ jobId: "job-kestrel" })).toEqual({
      kind: "not-approved", packageId: pkg.id, jobId: "job-kestrel", reason: "Your package isn't approved yet · open it to approve",
    });
    expect(t.preparation.packageForApply({ packageId: pkg.id })).toMatchObject({ kind: "not-approved" });
    expect(t.preparation.packageForApply({ jobId: "job-other" })).toEqual({ kind: "none" });
    expect(t.preparation.approvedPackages()).toEqual([]);
    expect(await t.preparation.packageFile(pkg.id, "cv")).toBeNull();
  });

  it("returns only approved content: the frozen files, the CV's work history, the letter and the approved answers", async () => {
    const t = mira();
    const pkg = await approved(t);

    const read = t.preparation.packageForApply({ jobId: "job-kestrel" });

    expect(read).toMatchObject({
      kind: "approved",
      package: {
        id: pkg.id, jobId: "job-kestrel", version: 1, state: "approved", language: "en", angle: "security",
        job: { title: "Security Engineer", company: "Kestrel Payments" },
        targetPosting: { url: "https://job-boards.greenhouse.io/kestrel/jobs/4410", site: "job-boards.greenhouse.io", jobRef: { portal: "greenhouse", board: "kestrel", jobId: "4410" } },
        cv: {
          label: "Security · Kestrel Payments", file: pkg.approved!.cv.file, ats: { passed: 10, total: 10, accepted: [] }, skills: ["Wazuh"],
          roles: [{ title: "Security Analyst", organisation: "Northwind Bank", place: "Sofia", start: "2022-03", end: null }],
          education: [{ title: "BSc Computer Science", organisation: "Danube Institute of Technology", place: "Ruse", start: "2018-09", end: "2022-06" }],
        },
        letter: { file: pkg.approved!.letter!.file },
      },
    });
    if (read.kind !== "approved") return;
    expect(read.package.letter!.text).toBe(pkg.letter!.text);
    expect(read.package.answers).toContainEqual({ question: "What are your salary expectations? (gross monthly, EUR)", answer: "3400" });
    expect(t.preparation.approvedPackages().map((p) => p.id)).toEqual([pkg.id]);
    expect((await t.preparation.packageFile(pkg.id, "cv"))!.bytes).toEqual((await t.preparation.packageCv(pkg.id))!.pdf);

    // Reopened by an edit, the draft is never read for filling.
    t.preparation.setScreeningAnswer(pkg.id, "question_31003", "3500");
    expect(t.preparation.packageForApply({ jobId: "job-kestrel" })).toMatchObject({ kind: "not-approved" });
    expect(t.preparation.approvedPackages()).toEqual([]);
  });

  it("finds a Job's package from the portal job reference of any of the Job's postings", async () => {
    const t = mira();
    const pkg = await started(t);

    expect(t.preparation.packageForApply({ jobRef: { portal: "greenhouse", board: "Kestrel", jobId: "4410" } })).toMatchObject({ kind: "not-approved", packageId: pkg.id, jobId: "job-kestrel" });
    expect(t.preparation.packageForApply({ jobRef: { portal: "greenhouse", board: null, jobId: "4410" } })).toMatchObject({ kind: "not-approved", packageId: pkg.id });
    expect(t.preparation.packageForApply({ jobRef: { portal: "greenhouse", board: "kestrel", jobId: "4499" } })).toEqual({ kind: "none" });
    expect(t.preparation.packageForApply({ jobRef: { portal: "lever", board: "kestrel", jobId: "4410" } })).toEqual({ kind: "none" });
  });

  it("the master profile as a portal's form asks for it", () => {
    const t = mira();

    expect(t.preparation.profileForApply()).toEqual({
      contact: {
        givenName: "Mira", familyName: "Petrova", fullName: "Mira Petrova", fullNameCyrillic: "Мира Петрова", email: "mira.petrova@example.com",
        phone: { countryCode: "+359", national: "88 000 0175", full: "+359 88 000 0175" }, city: "Sofia", country: "Bulgaria",
        linkedin: "https://www.linkedin.com/in/mira-petrova-example", github: null, portfolio: null,
      },
      roles: [{ title: "Security Analyst", organisation: "Northwind Bank", place: "Sofia", start: "2022-03", end: null, description: "" }],
      education: [{ title: "BSc Computer Science", organisation: "Danube Institute of Technology", place: "Ruse", start: "2018-09", end: "2022-06", field: null }],
      skills: ["Wazuh"],
    });
  });
});

describe("what Track reads (#35)", () => {
  it("marking a package submitted makes it submitted once; a second mark returns the first", async () => {
    const t = mira();
    const pkg = await approved(t);
    expect(t.preparation.approvedWithoutApplication().map((p) => p.id)).toEqual([pkg.id]);
    await t.clock.advance(60_000);

    const marked = t.preparation.markPackageSubmitted(pkg.id, { via: "extension", portalUrl: "https://job-boards.greenhouse.io/kestrel/jobs/4410/confirmation" });
    await t.clock.advance(60_000);
    const again = t.preparation.markPackageSubmitted(pkg.id, { via: "app", portalUrl: null });

    const submitted = { at: "2026-10-12T07:31:00.000Z", via: "extension", portalUrl: "https://job-boards.greenhouse.io/kestrel/jobs/4410/confirmation" };
    expect(marked).toMatchObject({ marked: true, alreadyMarked: false, package: { state: "submitted", submitted } });
    expect(again).toMatchObject({ marked: true, alreadyMarked: true, package: { submitted } });
    expect(t.preparation.approvedWithoutApplication()).toEqual([]);
    expect(t.preparation.packageSnapshot(pkg.id)).toMatchObject({ version: 1, state: "submitted", submitted });
  });

  it("refuses to mark a draft submitted", async () => {
    const t = mira();
    const pkg = await started(t);

    expect(t.preparation.markPackageSubmitted(pkg.id, { via: "app", portalUrl: null })).toEqual({ marked: false, reason: "Your package isn't approved yet · open it to approve" });
    expect(t.preparation.packageSnapshot(pkg.id)).toBeNull();
  });

  it("the snapshot of a submitted package never changes: later edits make a new version", async () => {
    const t = mira();
    const pkg = await approved(t);
    t.preparation.markPackageSubmitted(pkg.id, { via: "extension", portalUrl: null });
    const sent = t.preparation.packageSnapshot(pkg.id)!;

    t.preparation.setScreeningAnswer(pkg.id, "question_31003", "3600");
    t.preparation.approveStep(pkg.id, "answers");
    const v2 = await t.preparation.approvePackage(pkg.id);

    expect(v2).toMatchObject({ approved: true, package: { approved: { version: 2, state: "approved" } } });
    expect(t.preparation.packageSnapshot(pkg.id)).toEqual(sent);
    expect(sent.answers).toContainEqual({ question: "What are your salary expectations? (gross monthly, EUR)", answer: "3400" });
    expect(await t.preparation.packageFile(pkg.id, "cv", sent.version)).toMatchObject({ sha256: sent.cv.file.sha256 });
  });

  it("undoing the mark makes the package approved again, waiting for an Application", async () => {
    const t = mira();
    const pkg = await approved(t);
    t.preparation.markPackageSubmitted(pkg.id, { via: "extension", portalUrl: null });

    expect(t.preparation.undoPackageSubmitted(pkg.id)).toMatchObject({ state: "approved", submitted: null });
    expect(t.preparation.approvedWithoutApplication().map((p) => p.id)).toEqual([pkg.id]);
  });

  it("adds an unconfirmed piece from another feature, with its source, waiting in Profile", () => {
    const t = mira();

    const added = t.preparation.addUnconfirmedPiece({ text: "Led the post-incident review after a card-testing attack.", source: "Prep sheet for Security Engineer at Kestrel Payments" });

    expect(t.preparation.piece(added.id)).toMatchObject({ kind: "achievement", status: "unconfirmed", source: { from: "Prep sheet for Security Engineer at Kestrel Payments" } });
  });
});

describe("a profile change to a draft package", () => {
  it("marks the lines that use the changed piece, and Redraft these lines takes the profile's new wording", async () => {
    const t = mira();
    const pkg = await started(t);
    const phishing = t.preparation.piece(t.ids.phishing!)!;
    t.preparation.savePiece({ id: phishing.id, kind: "achievement", text: "Ran the response to a phishing campaign against the claims and fraud teams.", belongsTo: phishing.belongsTo, tags: phishing.tags, angles: phishing.angles });

    const changed = t.preparation.package(pkg.id)!;

    expect(changed.cvVersion!.profileChanged).toEqual({
      pieces: [{ id: phishing.id, label: "Ran the response to a phishing campaign against the claims and fraud teams." }],
      // The tailored summary cites it too.
      lines: ["Security analyst who writes SIEM detection rules and runs incident response at a bank.", "Ran the incident response to a phishing campaign against the claims team"],
    });

    const redrafted = await t.preparation.redraftChangedLines(pkg.id);

    expect(redrafted).toMatchObject({ changed: true, package: { cvVersion: { profileChanged: null } } });
    const printed = new TextDecoder().decode((await t.preparation.packageCv(pkg.id))!.pdf);
    expect(printed).toContain("Ran the response to a phishing campaign against the claims and fraud teams");
    expect(printed).not.toContain("against the claims team");
  });

  it("never touches an approved package", async () => {
    const t = mira();
    const pkg = await approved(t);
    const phishing = t.preparation.piece(t.ids.phishing!)!;
    t.preparation.savePiece({ id: phishing.id, kind: "achievement", text: "Ran the response to a phishing campaign against the claims and fraud teams.", belongsTo: phishing.belongsTo, tags: phishing.tags, angles: phishing.angles });

    const after = t.preparation.package(pkg.id)!;

    expect(after.cvVersion!.profileChanged).toBeNull();
    expect(after.approved).toEqual(pkg.approved);
    expect(await t.preparation.redraftChangedLines(pkg.id)).toMatchObject({ changed: false, reason: "This package is approved: what it sends stays as you approved it." });
  });
});
