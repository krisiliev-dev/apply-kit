import { describe, expect, it } from "vitest";
import { checkAts, type AtsCheckId, type AtsInput, type CvContent, type PdfText } from "../src/index.ts";

/** A made-up CV (fictional person). */
const cv: CvContent = {
  letterhead: {
    name: "Mira Petrova", headline: "Security Analyst", location: "Plovdiv, Bulgaria",
    email: "mira.petrova@example.com", phone: "+359 88 000 0199", links: ["linkedin.com/in/mira-petrova-example"],
  },
  summary: "Security analyst with 3 years in a bank SOC: detection engineering in Splunk and phishing response.",
  experience: [
    {
      title: "Security Analyst", employer: "Northwind Bank", place: "Plovdiv",
      start: { year: 2023, month: 1 }, end: "present",
      bullets: ["Built 30 Splunk detections that cut false positives by about a third"],
    },
    {
      title: "SOC Intern", employer: "Varna Telecom", place: "Varna",
      start: { year: 2022, month: 6 }, end: { year: 2022, month: 8 },
      bullets: ["Wrote Python scripts to enrich alerts with asset data"],
    },
  ],
  skills: ["Splunk", "Python", "Incident response"],
  education: [{ degree: "BSc Computer Science", school: "Plovdiv Tech", start: { year: 2018 }, end: { year: 2022 } }],
  languagesAndCourses: ["Bulgarian (native)", "English (C1)"],
};

/** What a parser reads from the CV above, one string per line, in reading order. */
function readBack({ internDates = "Jun 2022 – Aug 2022", leadDates = "Jan 2023 – present" } = {}): string[] {
  return [
    "Mira Petrova",
    "Security Analyst",
    "Plovdiv, Bulgaria · mira.petrova@example.com · +359 88 000 0199 · linkedin.com/in/mira-petrova-example",
    "SUMMARY",
    "Security analyst with 3 years in a bank SOC: detection engineering in Splunk and phishing response.",
    "EXPERIENCE",
    `Security Analyst · Northwind Bank, Plovdiv ${leadDates}`,
    "Built 30 Splunk detections that cut false positives by about a third",
    `SOC Intern · Varna Telecom, Varna ${internDates}`,
    "Wrote Python scripts to enrich alerts with asset data",
    "SKILLS",
    "Splunk · Python · Incident response",
    "EDUCATION",
    "BSc Computer Science · Plovdiv Tech 2018 – 2022",
    "LANGUAGES AND COURSES",
    "Bulgarian (native) · English (C1)",
  ];
}

const onePage = (lines: string[]): PdfText => ({ pages: [{ lines }] });

function check(overrides: Partial<AtsInput> = {}) {
  return checkAts({
    text: onePage(readBack()),
    document: { kind: "cv", language: "en", title: "Mira Petrova · CV", content: cv },
    fileName: "Mira_Petrova_CV_Kestrel_Security_Engineer.pdf",
    ...overrides,
  });
}

const result = (outcome: ReturnType<typeof checkAts>, id: AtsCheckId) => outcome.checks.find((c) => c.check === id)!;

describe("ATS check: dates readable as months and years", () => {
  it("fails a season with the role named", () => {
    const outcome = check({ text: onePage(readBack({ internDates: "Summer 2022" })) });

    expect(result(outcome, "dates")).toEqual({
      check: "dates", passed: false,
      problems: ["SOC Intern · Varna Telecom: “Summer 2022” isn't a month and year"],
      notes: [],
    });
  });

  it.each([
    ["06.2022 – 08.2022"],
    ["Jun 2022 – Aug 2022"],
    ["June 2022 - August 2022"],
    ["06/2022 – 08/2022"],
  ])("passes %s", (dates) => {
    expect(result(check({ text: onePage(readBack({ internDates: dates })) }), "dates").passed).toBe(true);
  });

  it("reads Bulgarian month names and \"досега\" for a current role", () => {
    const text = onePage(readBack({ leadDates: "01.2023 – досега", internDates: "юни 2022 – авг 2022" }));

    expect(result(check({ text }), "dates").passed).toBe(true);
  });

  it("fails a role dated by years alone, since a parser can't tell how long it lasted", () => {
    const outcome = check({ text: onePage(readBack({ internDates: "2022" })) });

    expect(result(outcome, "dates").problems).toEqual(["SOC Intern · Varna Telecom: “2022” isn't a month and year"]);
  });

  it("names a role whose line the parser lost", () => {
    const text = onePage(readBack().filter((l) => !l.startsWith("SOC Intern")));

    expect(result(check({ text }), "dates").problems).toEqual(["SOC Intern · Varna Telecom: the role's line wasn't found in the text"]);
  });
});

describe("ATS check: contact details found", () => {
  it("passes when the name, email, phone and links read back", () => {
    expect(result(check(), "contact")).toEqual({ check: "contact", passed: true, problems: [], notes: [] });
  });

  it("fails a missing email", () => {
    const lines = readBack();
    lines[2] = "Plovdiv, Bulgaria · +359 88 000 0199 · linkedin.com/in/mira-petrova-example";

    expect(result(check({ text: onePage(lines) }), "contact")).toMatchObject({ passed: false, problems: ["Email not found: mira.petrova@example.com"] });
  });

  it("fails a CV with no phone number or no location: a portal's contact fields are filled from them", () => {
    const content = { ...cv, letterhead: { ...cv.letterhead, phone: undefined, location: undefined } };
    const lines = readBack();
    lines[2] = "mira.petrova@example.com · linkedin.com/in/mira-petrova-example";

    expect(result(check({ text: onePage(lines), document: { kind: "cv", language: "en", title: "Mira Petrova · CV", content } }), "contact")).toMatchObject({
      passed: false, problems: ["No phone number on the CV", "No city or country on the CV"],
    });
  });

  it("finds a phone number however the parser spaced it", () => {
    const lines = readBack();
    lines[2] = "Plovdiv, Bulgaria · mira.petrova@example.com · +35988 0000199 · linkedin.com/in/mira-petrova-example";

    expect(result(check({ text: onePage(lines) }), "contact").passed).toBe(true);
  });
});

describe("ATS check: standard sections, one column, text-based, one page", () => {
  it("passes the template's own headings in their fixed order", () => {
    const outcome = check();

    expect(["sections", "single-column", "text-based", "pages"].map((id) => result(outcome, id as AtsCheckId).passed)).toEqual([true, true, true, true]);
  });

  it("finds the Bulgarian headings in a Bulgarian CV", () => {
    const bg = ["Мира Петрова", "Анализатор по сигурност", "Пловдив · mira.petrova@example.com · +359 88 000 0199 · linkedin.com/in/mira-petrova-example",
      "ПРОФИЛ", "…", "ПРОФЕСИОНАЛЕН ОПИТ", "УМЕНИЯ", "ОБРАЗОВАНИЕ", "ЕЗИЦИ И КУРСОВЕ"];
    const outcome = check({ text: onePage(bg), document: { kind: "cv", language: "bg", title: "Мира Петрова · CV", content: cv } });

    expect(result(outcome, "sections")).toMatchObject({ passed: true });
  });

  it("fails a heading the parser didn't find", () => {
    const text = onePage(readBack().filter((l) => l !== "SKILLS"));

    expect(result(check({ text }), "sections").problems).toEqual(["Section heading not found: Skills"]);
  });

  it("fails one column when two headings read as one line, as text from side-by-side columns does", () => {
    const lines = readBack().filter((l) => l !== "SKILLS").map((l) => (l === "EXPERIENCE" ? "EXPERIENCE SKILLS" : l));

    expect(result(check({ text: onePage(lines) }), "single-column")).toMatchObject({ passed: false });
  });

  it("fails one column when sections read out of order", () => {
    const lines = readBack();
    const [skills] = lines.splice(lines.indexOf("SKILLS"), 2);
    lines.splice(lines.indexOf("SUMMARY"), 0, skills!, "Splunk · Python · Incident response");

    expect(result(check({ text: onePage(lines) }), "single-column")).toMatchObject({ passed: false, problems: ["Sections read out of order: Skills before Summary"] });
  });

  it("fails a PDF with no text layer", () => {
    const outcome = check({ text: { pages: [{ lines: [] }] } });

    expect(result(outcome, "text-based")).toMatchObject({ passed: false, problems: ["No text could be read: the PDF is an image"] });
  });

  it("fails a CV that runs onto a second page, saying how far", () => {
    const outcome = check({ text: { pages: [{ lines: readBack() }, { lines: ["Wrote Python scripts", "to enrich alerts"] }] } });

    expect(result(outcome, "pages")).toMatchObject({ passed: false, problems: ["2 pages · 2 lines on page 2"] });
  });
});

describe("ATS check: posting keywords, lengths and the file name", () => {
  it("finds posting keywords as whole words and counts a deliberate gap as a pass, with its reason", () => {
    const outcome = check({ keywords: [{ term: "Splunk" }, { term: "incident response" }, { term: "Kubernetes", gap: "Named as a gap in the letter" }] });

    expect(result(outcome, "keywords")).toEqual({
      check: "keywords", passed: true, problems: [], notes: ["Kubernetes: Named as a gap in the letter"],
    });
  });

  it("fails a keyword the CV doesn't contain, never matching inside another word", () => {
    const outcome = check({ keywords: [{ term: "SOC" }, { term: "Elastic" }, { term: "Py" }] });

    expect(result(outcome, "keywords").problems).toEqual(["Posting keyword not found: Elastic", "Posting keyword not found: Py"]);
  });

  it("fails a bullet over 160 characters, naming its role", () => {
    const long = `Wrote Python scripts ${"that enrich alerts with asset and owner data ".repeat(4)}`.trim();
    const content = { ...cv, experience: [cv.experience[0]!, { ...cv.experience[1]!, bullets: [long] }] };

    const outcome = check({ document: { kind: "cv", language: "en", title: "CV", content } });

    expect(result(outcome, "bullets").problems).toEqual([`SOC Intern · Varna Telecom: a bullet is ${long.length} characters (160 at most)`]);
  });

  it("fails a summary over 400 characters", () => {
    const content = { ...cv, summary: "Security analyst. ".repeat(25).trim() };

    expect(result(check({ document: { kind: "cv", language: "en", title: "CV", content } }), "summary")).toMatchObject({ passed: false });
    expect(result(check(), "summary").passed).toBe(true);
  });

  it.each([
    ["Mira_Petrova_CV_Kestrel_Security_Engineer.pdf", true],
    ["Мира_Петрова_CV.pdf", false],
    ["Mira Petrova CV.pdf", false],
    ["Mira_Petrova_CV", false],
  ])("checks the file name %s is ASCII", (fileName, passed) => {
    expect(result(check({ fileName }), "file-name").passed).toBe(passed);
  });
});
