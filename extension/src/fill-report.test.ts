import { describe, expect, it } from "vitest";
import type { FieldAnswer, FieldOutcome, PackageInBrief, PageReading, ReadField, SubmittedApplication } from "@apply-kit/core";
import {
  characterCount, differentJobLine, fieldRows, fileReport, fileSize, fillAnnouncement, fillButtonLabel, focusAfterFill, markedBanner, markedLines, matchWhy, needsYouItems, packageLines, saveTypedLabel, sourceWords, stoppedMidFill, stuckFields, submitPrompt, typedAnswerLine,
} from "./fill-report.ts";

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

describe("needs-you items", () => {
  const r: PageReading = { ...reading, fields: [
    { ...field("sal", "Expected gross monthly salary (EUR)"), kind: "number" },
    { ...field("det", "Describe a detection rule you wrote."), kind: "textarea", maxLength: 1000 },
    { ...field("clr", "Have you ever held a government security clearance?"), kind: "radio", options: ["Yes", "No"] },
    { ...field("src", "How did you hear about us?"), kind: "select", options: ["LinkedIn", "Referral", "Company website"] },
    { ...field("cv", "Resume/CV"), kind: "file" },
    field("fn", "First Name"),
  ] };
  const a: FieldAnswer[] = [
    { fieldId: "sal", kind: "needs-you", reason: "Your answer bank says: ask each time", basis: "Your rule: \"Upper half\".", suggestion: "3300" },
    { fieldId: "det", kind: "needs-you", reason: "A new question: check the draft before you fill it", basis: "Drafted from your master profile: \"Wrote 30 detection rules.\" Nothing added that isn't there.", draft: "At Northwind Bank I wrote 30 detection rules.", save: { ticked: false, note: "This reads as a one-off for Kestrel Payments" } },
    { fieldId: "clr", kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null, save: { ticked: true, note: null } },
    { fieldId: "src", kind: "needs-you", reason: "apply-kit has no answer for this yet", basis: null, save: { ticked: true, note: null } },
    { fieldId: "cv", kind: "needs-you", reason: "Attach the CV yourself for now", basis: null },
    { fieldId: "fn", kind: "fill", value: "Mira", source: "profile", basis: null },
  ];
  const o: FieldOutcome[] = a.map((x) => ({ fieldId: x.fieldId, outcome: x.kind === "fill" ? "filled" : "needs-you", source: x.kind === "fill" ? "profile" : null }));

  it("gives each one the right control, its suggestion or draft, its basis and its Save to answer bank tick", () => {
    expect(needsYouItems(r, a, o)).toEqual([
      { fieldId: "sal", question: "Expected gross monthly salary (EUR)", limit: null, control: { kind: "number" }, value: "3300", basis: "Your answer bank says: ask each time. Your rule: \"Upper half\".", save: null },
      {
        fieldId: "det", question: "Describe a detection rule you wrote.", limit: "max 1,000 characters", control: { kind: "long-text", max: 1000 }, value: "At Northwind Bank I wrote 30 detection rules.",
        basis: "A new question: check the draft before you fill it. Drafted from your master profile: \"Wrote 30 detection rules.\" Nothing added that isn't there.", save: { ticked: false, note: "This reads as a one-off for Kestrel Payments" },
      },
      { fieldId: "clr", question: "Have you ever held a government security clearance?", limit: null, control: { kind: "yes-no", options: ["Yes", "No"] }, value: "", basis: "apply-kit has no answer for this yet", save: { ticked: true, note: null } },
      { fieldId: "src", question: "How did you hear about us?", limit: null, control: { kind: "choice", options: ["LinkedIn", "Referral", "Company website"] }, value: "", basis: "apply-kit has no answer for this yet", save: { ticked: true, note: null } },
      { fieldId: "cv", question: "Resume/CV", limit: null, control: { kind: "file" }, value: "", basis: "Attach the CV yourself for now", save: null },
    ]);
  });

  it("only lists what still needs Kris: an item he filled from the panel shows as You", () => {
    const filledByKris = o.map((x) => (x.fieldId === "clr" ? { ...x, outcome: "filled" as const, source: "you" as const } : x));
    expect(needsYouItems(r, a, filledByKris).map((i) => i.fieldId)).toEqual(["sal", "det", "src", "cv"]);
    expect(fieldRows(r, a, filledByKris).find((x) => x.fieldId === "clr")).toMatchObject({ chip: { tone: "met", word: "You" } });
  });

  it("shows an answer Kris typed on the page as his", () => {
    const typed = { ...r, fields: r.fields.map((f) => (f.id === "clr" ? { ...f, value: "No" } : f)) };
    const kept = o.map((x) => (x.fieldId === "clr" ? { ...x, outcome: "kept" as const } : x));
    expect(fieldRows(typed, a, kept).find((x) => x.fieldId === "clr")).toMatchObject({ value: "No", chip: { tone: "met", word: "You" }, why: "You answered this on the page.", offer: null });
  });

  it("names the Fill button after the value", () => {
    expect(fillButtonLabel({ kind: "number" }, "3300")).toBe("Fill 3,300");
    expect(fillButtonLabel({ kind: "yes-no", options: ["Yes", "No"] }, "No")).toBe('Fill "No"');
    expect(fillButtonLabel({ kind: "choice", options: ["LinkedIn"] }, "")).toBe("Fill");
    expect(fillButtonLabel({ kind: "long-text", max: 1000 }, "At Northwind…")).toBe("Fill this answer");
  });
});

describe("character count", () => {
  it("is always visible, and announced once when 50 or fewer characters are left", () => {
    let warned = false;
    const at = (length: number) => {
      const c = characterCount(length, 1000, warned);
      warned = c.warned;
      return [c.text, c.announce];
    };
    expect(at(312)).toEqual(["312 / 1,000", null]);
    expect(at(950)).toEqual(["950 / 1,000", "50 characters left"]);
    expect(at(960)).toEqual(["960 / 1,000", null]);
    expect(at(999)).toEqual(["999 / 1,000", null]);
    // Back over 50 left, then down again: said once more.
    expect(at(900)).toEqual(["900 / 1,000", null]);
    expect(at(990)).toEqual(["990 / 1,000", "10 characters left"]);
    expect(characterCount(999, 1000, false).announce).toBe("1 character left");
  });
});

describe("answers Kris typed on the portal", () => {
  it("lists each as question → answer, and counts the ones to save", () => {
    expect(typedAnswerLine({ id: "1", question: "Are you willing to travel up to 10%?", answer: "Yes", kind: "yes-no", save: { ticked: true, note: null } })).toBe('"Are you willing to travel up to 10%?" → Yes');
    expect(saveTypedLabel(2)).toBe("Save 2 to the answer bank");
    expect(saveTypedLabel(1)).toBe("Save 1 to the answer bank");
  });
});

describe("recovery", () => {
  const phoneReading: PageReading = { ...reading, fields: [field("code", "Country Phone Code"), field("phone", "Phone Number"), field("fn", "First Name")] };
  const phoneAnswers: FieldAnswer[] = [
    { fieldId: "code", kind: "fill", value: "+359", source: "profile", basis: null },
    { fieldId: "phone", kind: "fill", value: "88 000 0175", source: "profile", basis: "Without +359, which is in Country Phone Code" },
    { fieldId: "fn", kind: "fill", value: "Mira", source: "profile", basis: null },
  ];
  const stuck: FieldOutcome[] = [{ fieldId: "code", outcome: "filled", source: "profile" }, { fieldId: "phone", outcome: "didnt-stick", source: null }, { fieldId: "fn", outcome: "filled", source: "profile" }];

  it("names a field that didn't stick and gives its value to copy in the field's format, with Try once more", () => {
    expect(stuckFields(phoneReading, phoneAnswers, stuck, new Set(), "Greenhouse")).toEqual([{
      fieldId: "phone", label: "Phone Number", heading: "Phone Number didn't stick",
      text: "Greenhouse cleared or changed it right after filling. Paste it in yourself, in the format the field wants:",
      copyLabel: "Phone Number · without +359, which is in Country Phone Code", value: "88 000 0175", tryOnceMore: true,
    }]);
    expect(fieldRows(phoneReading, phoneAnswers, stuck).find((r) => r.fieldId === "phone")).toMatchObject({ value: "88 000 0175", chip: { tone: "gap", word: "Didn't stick" }, offer: "88 000 0175" });
  });

  it("offers Try once more only once per field", () => {
    expect(stuckFields(phoneReading, phoneAnswers, stuck, new Set(["phone"]), "Greenhouse")).toEqual([expect.objectContaining({
      tryOnceMore: false, text: "Greenhouse cleared it again after Try once more. Paste it in yourself, in the format the field wants:",
    })]);
  });

  it("says how many fields stay filled when apply-kit stops answering mid-fill", () => {
    expect(stoppedMidFill(stuck)).toBe("apply-kit stopped answering after filling 2 fields on this page. They stay filled, and Undo this page still puts them back.");
    expect(stoppedMidFill([stuck[0]!])).toBe("apply-kit stopped answering after filling 1 field on this page. It stays filled, and Undo this page still puts it back.");
  });
});
