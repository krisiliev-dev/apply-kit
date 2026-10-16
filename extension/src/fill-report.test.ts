import { describe, expect, it } from "vitest";
import type { FieldAnswer, FieldOutcome, PackageInBrief, PageReading, ReadField } from "@apply-kit/core";
import { differentJobLine, fieldRows, fileReport, fileSize, fillAnnouncement, focusAfterFill, matchWhy, packageLines, sourceWords } from "./fill-report.ts";

const field = (id: string, label: string, value = ""): ReadField => ({ id, label, kind: "text", required: true, value, options: [], maxLength: null, consent: false, password: false, hint: null });
const reading: PageReading = {
  pageKind: "form", jobRef: { portal: "greenhouse", board: "kestrel", jobId: "4410" }, stepLabel: null, stepCount: null,
  fields: [field("fn", "First Name"), field("email", "Email"), field("phone", "Phone", "+359 000 0000"), field("gh", "GitHub"), field("gdpr", "I agree")],
};
const answers: FieldAnswer[] = [
  { fieldId: "fn", kind: "fill", value: "Mira", source: "profile", basis: null },
  { fieldId: "email", kind: "fill", value: "mira.petrova@example.com", source: "profile", basis: "Your job address" },
  { fieldId: "phone", kind: "fill", value: "+359 88 000 0175", source: "profile", basis: null },
  { fieldId: "gh", kind: "needs-you", reason: "Your profile has no GitHub link", basis: null },
  { fieldId: "gdpr", kind: "skip", reason: "Consent boxes are yours to tick" },
];
const outcomes: FieldOutcome[] = [
  { fieldId: "gdpr", outcome: "skipped", source: null },
  { fieldId: "fn", outcome: "filled", source: "profile" },
  { fieldId: "email", outcome: "filled", source: "profile" },
  { fieldId: "phone", outcome: "kept", source: null },
  { fieldId: "gh", outcome: "needs-you", source: null },
];

const brief: PackageInBrief = {
  id: "p1", version: 3, approvedAt: "2026-10-12T07:30:00Z", job: { title: "Security Engineer", company: "Kestrel Payments" },
  jobRef: { portal: "greenhouse", board: "kestrel", jobId: "4410" }, language: "en",
  cv: { fileName: "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf", size: 151_552, label: "Security · Kestrel Payments", angle: "security", ats: { passed: 10, total: 10, accepted: [] } },
  answers: 6, letter: true,
};

describe("what the Fill view says", () => {
  it("names every source in words", () => {
    expect(["profile", "answer-bank", "package", "cv-version", "you"].map((s) => sourceWords(s as never))).toEqual(["Profile", "Answer bank", "Package", "CV version", "You"]);
  });

  it("announces 'N filled, M need you' at the end of a fill", () => {
    expect(fillAnnouncement({ filled: 6, needsYou: 1, kept: 0, didntStick: 0, skipped: 2 })).toBe("6 filled, 1 needs you");
    expect(fillAnnouncement({ filled: 3, needsYou: 2, kept: 1, didntStick: 1, skipped: 0 })).toBe("3 filled, 2 need you, 1 kept, 1 didn't stick");
    expect(fillAnnouncement({ filled: 4, needsYou: 0, kept: 0, didntStick: 0, skipped: 0 })).toBe("4 filled, 0 need you");
  });

  it("lists the fields in the portal's order, each label → value → source", () => {
    expect(fieldRows(reading, answers, outcomes).map((r) => [r.label, r.value, r.chip.word, r.why, r.offer])).toEqual([
      ["First Name", "Mira", "Profile", null, null],
      ["Email", "mira.petrova@example.com", "Profile", "Your job address", null],
      ["Phone", "+359 000 0000", "Kept", "The field already had this value, so apply-kit left it.", "+359 88 000 0175"],
      ["GitHub", "Not filled", "Needs you", "Your profile has no GitHub link", null],
      ["I agree", "Not filled", "Skipped", "Consent boxes are yours to tick", null],
    ]);
  });

  it("moves focus to the first needs-you item after a fill, else leaves it on Fill this page", () => {
    expect(focusAfterFill(outcomes)).toBe("gh");
    expect(focusAfterFill(outcomes.filter((o) => o.outcome !== "needs-you"))).toBeNull();
  });

  it("says why the page matched the package", () => {
    const matched = { kind: "matched" as const, why: "job-id" as const, continued: false, package: brief, session: null };
    expect(matchWhy(matched, reading.jobRef)).toBe("Matched: job ID 4410 is your package's target posting.");
    expect(matchWhy({ ...matched, why: "chosen" }, { portal: "greenhouse", board: "kestrel", jobId: "4499" })).toBe("You chose this package for job 4499.");
    expect(matchWhy({ ...matched, why: "same-job" }, { portal: "greenhouse", board: null, jobId: "4410" })).toBe("Matched: job 4410 is another posting of the job your package is for.");
  });

  it("summarises the package in words", () => {
    expect(packageLines(brief)).toEqual([
      { term: "CV", detail: "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf", note: "Security angle · v3 · ATS check passed" },
      { term: "Answers", detail: "6 approved screening answers, plus your answer bank", note: null },
      { term: "Letter", detail: "Ready; used if the portal asks for one", note: null },
    ]);
  });

  it("says a different job got nothing from the old package", () => {
    expect(differentJobLine({ packageId: "p1", job: { title: "Security Engineer", company: "Kestrel Payments" }, jobRef: { portal: "greenhouse", board: "kestrel", jobId: "4410" } }, { title: "Cloud Security Analyst", jobId: "4420" }))
      .toBe("The tab moved from Security Engineer (4410) to Cloud Security Analyst (4420). Nothing was filled from the Security Engineer package.");
  });

  it("names a file's size in KB, or MB from a megabyte", () => {
    expect([fileSize(151_552), fileSize(300), fileSize(1_258_291)]).toEqual(["148 KB", "1 KB", "1.2 MB"]);
  });

  describe("the package's files on the page", () => {
    const cvName = "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf";
    const fileReading: PageReading = { ...reading, fields: [field("fn", "First Name"), { ...field("resume", "Resume/CV"), kind: "file" }, { ...field("letter", "Cover Letter"), kind: "textarea" }] };
    const cvAnswer: FieldAnswer = { fieldId: "resume", kind: "file", which: "cv", fileName: cvName, size: 151_552, source: "package", basis: "Your package's CV, v3" };
    const fn: FieldAnswer = { fieldId: "fn", kind: "fill", value: "Mira", source: "profile", basis: null };
    const letterText: FieldAnswer = { fieldId: "letter", kind: "fill", value: "Dear Kestrel Payments team,", source: "package", basis: "Your package's letter, v3" };

    it("shows the attached CV as a chip: name, size, angle, version, approval date, ATS check", () => {
      const r = fileReport(brief, [fn, cvAnswer], [{ fieldId: "fn", outcome: "filled", source: "profile" }, { fieldId: "resume", outcome: "filled", source: "package" }], "Greenhouse");
      expect(r).toEqual({
        attached: [{ which: "cv", fieldId: "resume", fileName: cvName, line: `CV attached: ${cvName} · 148 KB`, meta: "Security angle · v3 · approved 12 Oct · ATS check passed" }],
        failed: [], letter: "This page has no cover letter field, so your letter wasn't used.",
      });
      expect(fieldRows(fileReading, [cvAnswer], [{ fieldId: "resume", outcome: "filled", source: "package" }]).map((x) => [x.label, x.value, x.chip.word, x.why])).toEqual([["Resume/CV", cvName, "Package", "Your package's CV, v3"]]);
    });

    it("says the CV didn't attach and how to attach it yourself", () => {
      const r = fileReport(brief, [cvAnswer, letterText], [{ fieldId: "resume", outcome: "didnt-stick", source: null }, { fieldId: "letter", outcome: "filled", source: "package" }], "Greenhouse");
      expect(r).toEqual({
        attached: [],
        failed: [{ which: "cv", fieldId: "resume", fileName: cvName, size: "148 KB", chip: "CV not attached", heading: "Your CV didn't attach.", text: "Greenhouse's upload box didn't accept the file from apply-kit. Attach it yourself: it's ready in your Packages folder." }],
        letter: null,
      });
      expect(fieldRows(fileReading, [cvAnswer], [{ fieldId: "resume", outcome: "didnt-stick", source: null }]).map((x) => [x.value, x.chip.word, x.why])).toEqual([["Not attached", "Didn't attach", "Attach it yourself from your Packages folder."]]);
    });

    it("says nothing about the letter when the package has none", () => {
      expect(fileReport({ ...brief, letter: false }, [fn], [{ fieldId: "fn", outcome: "filled", source: "profile" }], "Greenhouse").letter).toBeNull();
    });
  });
});
