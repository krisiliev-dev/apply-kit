import { describe, expect, it } from "vitest";
import type { FieldAnswer, FieldOutcome, PackageInBrief, PageReading, ReadField } from "@apply-kit/core";
import { differentJobLine, fieldRows, fillAnnouncement, focusAfterFill, matchWhy, packageLines, sourceWords } from "./fill-report.ts";

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
});
