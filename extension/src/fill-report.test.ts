import { describe, expect, it } from "vitest";
import type { FieldAnswer, FieldOutcome, PackageInBrief, PageReading, ReadField, SubmittedApplication } from "@apply-kit/core";
import { differentJobLine, duplicatesReport, earlierPages, fieldRows, fileReport, fileSize, fillAnnouncement, focusAfterFill, markedBanner, markedLines, matchWhy, packageLines, pageSummary, reviewChecks, sourceWords, startScreen, stepLine, submitPrompt, type PageSummary } from "./fill-report.ts";

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
        attached: [{ which: "cv", fieldId: "resume", fileName: cvName, label: "CV attached:", line: `${cvName} · 148 KB`, meta: "Security angle · v3 · approved 12 Oct · ATS check passed" }],
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

describe("what the panel says about submitting", () => {
  const application = {
    id: "a1", jobId: "j1", title: "Security Engineer", company: "Kestrel Payments", status: "applied", appliedOn: "2026-10-13", createdHow: "submission",
    submission: { packageId: "p1", portal: "greenhouse", portalUrl: "https://job-boards.greenhouse.io/kestrel/jobs/4410/confirmation", submittedAt: "2026-10-13T11:20:00.000Z", via: "extension" },
  } as SubmittedApplication;

  it("asks \"Did you submit?\" only on a confirmation page, offers \"I've submitted this\" on unknown forms, and never on a review page", () => {
    expect(submitPrompt({ known: true, pageKind: "confirmation" })).toBe("ask");
    expect(submitPrompt({ known: false, pageKind: null })).toBe("footer");
    expect(submitPrompt({ known: false, pageKind: "form" })).toBe("footer");
    for (const pageKind of ["review", "form", "account", "sign-in", "other"] as const) expect(submitPrompt({ known: true, pageKind }), pageKind).toBeNull();
    expect(submitPrompt({ known: false, pageKind: "review" })).toBeNull();
  });

  it("says the Application was created, or when it was marked already", () => {
    expect(markedBanner({ alreadyMarked: false, application })).toEqual({ lead: "Application created.", rest: "Security Engineer at Kestrel Payments is now tracked." });
    expect(markedBanner({ alreadyMarked: true, application })).toEqual({ lead: "Already marked as submitted on 13 Oct.", rest: "Security Engineer at Kestrel Payments has its Application; nothing new was created." });
  });

  it("lists the Application's status, when and where it was submitted, the package and the portal, in Sofia time", () => {
    expect(markedLines(application, brief)).toEqual([
      { term: "Status", detail: "Applied" },
      { term: "Submitted", detail: "13 Oct, 14:20, via Greenhouse" },
      { term: "Package", detail: "CV v3 · 6 answers · ATS check passed" },
      { term: "Portal", detail: "job-boards.greenhouse.io" },
    ]);
    const fromApp = { ...application, submission: { ...application.submission, portalUrl: null, via: "app" as const } };
    expect(markedLines(fromApp, { ...brief, answers: 1, cv: { ...brief.cv, ats: { passed: 9, total: 10, accepted: [] } } })).toEqual([
      { term: "Status", detail: "Applied" },
      { term: "Submitted", detail: "13 Oct, 14:20, marked in apply-kit" },
      { term: "Package", detail: "CV v3 · 1 answer · 9 of 10 ATS checks pass" },
    ]);
  });
});

describe("question rows", () => {
  it("names Answer bank, Package, Skipped · your rule and Needs you, with the suggestion and the field's limit", () => {
    const r: PageReading = { ...reading, fields: [
      field("rw", "Do you require visa sponsorship?"), field("np", "What is your notice period?"),
      { ...field("sal", "Expected gross monthly salary"), maxLength: null }, { ...field("det", "Describe a detection rule"), kind: "textarea", maxLength: 1000 },
      field("g", "Gender"),
    ] };
    const a: FieldAnswer[] = [
      { fieldId: "rw", kind: "fill", value: "No", source: "answer-bank", basis: null },
      { fieldId: "np", kind: "fill", value: "1 month", source: "package", basis: "Approved screening answer in this package" },
      { fieldId: "sal", kind: "needs-you", reason: "Your answer bank says: ask each time", basis: "Your rule: \"Upper half\".", suggestion: "2000" },
      { fieldId: "det", kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null },
      { fieldId: "g", kind: "skip", reason: "Your rule leaves voluntary questions blank", byRule: true },
    ];
    const o: FieldOutcome[] = [
      { fieldId: "rw", outcome: "filled", source: "answer-bank" }, { fieldId: "np", outcome: "filled", source: "package" },
      { fieldId: "sal", outcome: "needs-you", source: null }, { fieldId: "det", outcome: "needs-you", source: null }, { fieldId: "g", outcome: "skipped", source: null },
    ];

    expect(fieldRows(r, a, o).map((x) => [x.label, x.value, x.chip.word, x.why, x.limit])).toEqual([
      ["Do you require visa sponsorship?", "No", "Answer bank", null, null],
      ["What is your notice period?", "1 month", "Package", "Approved screening answer in this package", null],
      ["Expected gross monthly salary", "Suggested: 2000", "Needs you", "Your answer bank says: ask each time. Your rule: \"Upper half\".", null],
      ["Describe a detection rule", "Not filled", "Needs you", "apply-kit has no answer for this yet", "max 1,000 characters"],
      ["Gender", "Not filled", "Skipped · your rule", "Your rule leaves voluntary questions blank", null],
    ]);
  });
});

describe("what the Fill view says on Workday", () => {
  const wd = (fields: ReadField[], stepLabel = "My Experience"): PageReading => ({ pageKind: "form", jobRef: { portal: "workday", board: "kestrelpayments", jobId: "R-10482" }, stepLabel, stepCount: { current: 2, total: 6 }, fields });
  const section = { ...field("workExperience", "Work Experience", "3"), kind: "repeating" as const, required: false, entry: { section: "work" as const, index: 0 } };
  const dupes = [{ index: 3, words: "Junior Security Analyst, Orbital Bank, from 2023" }, { index: 4, words: "SOC Intern, Varna Telecom, from 2022" }];
  const entries = (add: number, duplicates = dupes): FieldAnswer => ({ fieldId: "workExperience", kind: "entries", section: "work", add, duplicates, source: "cv-version", basis: "2 roles on the CV in your package" });

  it("reports Workday's duplicates in words, with Remove and Keep, and nothing removed yet", () => {
    expect(duplicatesReport([entries(0)])).toEqual({
      section: "work", fieldId: "workExperience", indexes: [3, 4],
      question: "Workday added 2 job entries after reading your CV",
      basis: "\"Junior Security Analyst, Orbital Bank, from 2023\" and \"SOC Intern, Varna Telecom, from 2022\" repeat roles on your CV. Nothing was removed.",
      remove: "Remove the 2 duplicates", keep: "Keep them", show: "Work Experience 3",
    });
    expect(duplicatesReport([entries(0, [dupes[0]!])])).toMatchObject({ question: "Workday added 1 job entry after reading your CV", remove: "Remove the duplicate" });
    expect(duplicatesReport([entries(0, [])])).toBeNull();
  });

  it("lists a section as its entries, and a list apply-kit couldn't press as a choice for Kris", () => {
    const rows = fieldRows(wd([section, { ...field("country", "Country"), kind: "select" }, { ...field("city", "City"), kind: "typeahead" }]), [
      entries(1, []), { fieldId: "country", kind: "fill", value: "Bulgaria", source: "profile", basis: null }, { fieldId: "city", kind: "fill", value: "Sofia", source: "profile", basis: null },
    ], [
      { fieldId: "workExperience", outcome: "needs-you", source: null }, { fieldId: "country", outcome: "needs-you", source: null },
      { fieldId: "city", outcome: "needs-you", source: null, choices: ["Sofia, Sofia City, Bulgaria", "Sofia, Sofia Province, Bulgaria"] },
    ]);
    expect(rows.map((r) => [r.label, r.value, r.chip.word, r.why, r.choices])).toEqual([
      ["Work Experience", "Add 1 more entry", "Needs you", "Add it with Workday's Add button; apply-kit can't press it. 2 roles on the CV in your package", null],
      ["Country", "Choose: Bulgaria", "Needs you", "apply-kit can't open Workday's lists yet. Choose it on the page", null],
      ["City", "Suggested: Sofia, Sofia City, Bulgaria", "Needs you", "Workday offers more than one match for \"Sofia\"", ["Sofia, Sofia City, Bulgaria", "Sofia, Sofia Province, Bulgaria"]],
    ]);
    const done = fieldRows(wd([section]), [entries(0, [])], [{ fieldId: "workExperience", outcome: "filled", source: "cv-version" }]);
    expect(done.map((r) => [r.value, r.chip.word, r.why])).toEqual([["3 entries", "CV version", "2 roles on the CV in your package"]]);
  });

  it("says where Kris is: the step and count Workday prints, or only 'this page'", () => {
    expect(stepLine(wd([]), "Workday", "14:04")).toBe("Page 2 of 6, as Workday shows it. Filled 14:04.");
    expect(stepLine({ ...wd([]), stepCount: null }, "Workday", "14:04")).toBe("Filled 14:04.");
  });

  const pages: PageSummary[] = [
    { step: "My Information", filled: 6, chosen: ["City"], cv: null, duplicatesRemoved: 0, didntStick: ["Phone Number"], byRule: 0 },
    { step: "My Experience", filled: 9, chosen: [], cv: "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf", duplicatesRemoved: 2, didntStick: [], byRule: 0 },
    { step: "Voluntary Disclosures", filled: 0, chosen: [], cv: null, duplicatesRemoved: 0, didntStick: [], byRule: 3 },
  ];

  it("summarises the earlier pages, one line each", () => {
    expect(earlierPages(pages)).toEqual({
      heading: "Earlier pages · 16 filled",
      lines: ["My Information · 7 filled (1 you chose: City), 1 to paste yourself", "My Experience · 9 filled, CV attached, 2 Workday duplicates removed", "Voluntary Disclosures · 3 left blank by your rule"],
    });
    expect(earlierPages([])).toBeNull();
  });

  it("lists what's worth a look on the review page", () => {
    expect(reviewChecks(pages)).toEqual([
      { tone: "ok", text: "CV attached: Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf" },
      { tone: "ok", text: "16 fields filled across 3 pages" },
      { tone: "nb", text: "1 value to paste yourself: Phone Number" },
      { tone: "nb", text: "2 Workday duplicates removed on My Experience" },
      { tone: "dim", text: "3 voluntary questions left blank, by your rule" },
    ]);
    expect(reviewChecks([])).toEqual([{ tone: "dim", text: "No pages filled in this panel yet" }]);
  });

  it("summarises a page as it's left", () => {
    expect(pageSummary(wd([section, { ...field("resume", "Resume/CV"), kind: "file" }, field("x", "Gender")]), [
      entries(0), { fieldId: "resume", kind: "file", which: "cv", fileName: "cv.pdf", size: 1, source: "package", basis: "" }, { fieldId: "x", kind: "skip", reason: "", byRule: true },
    ], [{ fieldId: "workExperience", outcome: "filled", source: "cv-version" }, { fieldId: "resume", outcome: "filled", source: "package" }, { fieldId: "x", outcome: "skipped", source: null }], { chosen: [], duplicatesRemoved: 2 })).toEqual({
      step: "My Experience", filled: 2, chosen: [], cv: "cv.pdf", duplicatesRemoved: 2, didntStick: [], byRule: 1,
    });
  });

  it("on Workday's start screen, says to choose Apply Manually, in words", () => {
    expect(startScreen("Workday")).toEqual({ heading: "Choose Apply Manually on Workday", text: "apply-kit fills the form you get after it, page by page. Autofill with Resume makes Workday read your CV and add entries of its own to check. apply-kit never presses these choices." });
  });
});
