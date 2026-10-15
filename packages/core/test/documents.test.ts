import { describe, expect, it } from "vitest";
import type { CvContent, DocumentToRender, PdfText } from "../src/index.ts";
import { createTestPreparation, fakeRenderer, memoryPackageFolder } from "./preparation-harness.ts";

/** A made-up CV (fictional person). */
const cv: CvContent = {
  letterhead: {
    name: "Mira Petrova", headline: "Security Analyst", location: "Plovdiv, Bulgaria",
    email: "mira.petrova@example.com", phone: "+359 88 000 0199", links: ["linkedin.com/in/mira-petrova-example"],
  },
  summary: "Security analyst with 3 years in a bank SOC.",
  experience: [{
    title: "Security Analyst", employer: "Northwind Bank", place: "Plovdiv",
    start: { year: 2023, month: 1 }, end: "present",
    bullets: ["Built 30 Splunk detections that cut false positives by about a third"],
  }],
  skills: ["Splunk", "Python"],
  education: [{ degree: "BSc Computer Science", school: "Plovdiv Tech", start: { year: 2018 }, end: { year: 2022 } }],
  languagesAndCourses: [],
};

const cvDocument: DocumentToRender = { kind: "cv", language: "en", title: "Mira Petrova · CV · Kestrel Payments", content: cv };
const forKestrel = { name: "Mira Petrova", company: "Kestrel Payments", role: "Security Engineer" };

/** Lays a CV out roughly as the template does, `perPage` lines to a page: a stand-in for the real PDF. */
function cvLayout(perPage = 50) {
  return (doc: DocumentToRender): PdfText => {
    if (doc.kind !== "cv") return { pages: [{ lines: [doc.title] }] };
    const c = doc.content;
    const h = c.letterhead;
    const lines = [
      h.name, h.headline, [h.location, h.email, h.phone, ...h.links].filter(Boolean).join(" · "),
      "SUMMARY", c.summary,
      "EXPERIENCE", ...c.experience.flatMap((r) => [`${r.title} · ${r.employer}, ${r.place} Jan 2023 – present`, ...r.bullets]),
      "SKILLS", c.skills.join(" · "),
      "EDUCATION", ...c.education.map((e) => `${e.degree} · ${e.school} 2018 – 2022`),
    ];
    const pages: PdfText["pages"] = [];
    for (let i = 0; i < lines.length; i += perPage) pages.push({ lines: lines.slice(i, i + perPage) });
    return { pages };
  };
}

describe("drafting a document", () => {
  it("prints the CV, keeps the draft in the package's folder under an ASCII file name and reads it back", async () => {
    const packages = memoryPackageFolder();
    const t = createTestPreparation({ renderer: fakeRenderer(cvLayout()), packages });

    const draft = await t.preparation.draftDocument({ packageId: "p1", document: cvDocument, fileName: forKestrel });

    expect(draft).toMatchObject({
      fileName: "Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf",
      path: "packages/p1/Mira_Petrova_CV_Kestrel_Payments_Security_Engineer.pdf",
      pages: 1,
      overflow: null,
    });
    expect(packages.files.get(draft.path)).toEqual(draft.pdf);
    expect(draft.size).toBe(draft.pdf.byteLength);
    expect(draft.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(draft.text.pages[0]!.lines.slice(0, 2)).toEqual(["Mira Petrova", "Security Analyst"]);
  });

  it("runs the ATS check on the text read back from the PDF", async () => {
    const t = createTestPreparation({ renderer: fakeRenderer(cvLayout()) });

    const draft = await t.preparation.draftDocument({
      packageId: "p1", document: cvDocument, fileName: forKestrel,
      keywords: [{ term: "Splunk" }, { term: "Elastic" }],
    });

    expect(draft.ats!.checks.filter((c) => !c.passed)).toEqual([
      { check: "keywords", passed: false, problems: ["Posting keyword not found: Elastic"], notes: [] },
    ]);
  });

  it("reports long content running onto page 2, and never shrinks it to fit", async () => {
    const rendered: DocumentToRender[] = [];
    const layout = cvLayout(8);
    const t = createTestPreparation({ renderer: fakeRenderer((doc) => (rendered.push(doc), layout(doc))) });

    const draft = await t.preparation.draftDocument({ packageId: "p1", document: cvDocument, fileName: forKestrel });

    expect(draft).toMatchObject({ pages: 2, overflow: { pages: 2, linesAfterFirstPage: 4 } });
    expect(draft.ats!.checks.find((c) => c.check === "pages")).toMatchObject({ passed: false, problems: ["2 pages · 4 lines on page 2"] });
    expect(rendered).toEqual([cvDocument]);
  });

  it("replaces the previous draft of the same document", async () => {
    const packages = memoryPackageFolder();
    const t = createTestPreparation({ renderer: fakeRenderer(cvLayout()), packages });
    await t.preparation.draftDocument({ packageId: "p1", document: cvDocument, fileName: forKestrel });

    const shorter = { ...cvDocument, content: { ...cv, skills: ["Splunk"] } };
    const draft = await t.preparation.draftDocument({ packageId: "p1", document: shorter, fileName: forKestrel });

    expect([...packages.files.keys()]).toEqual([draft.path]);
    expect(packages.files.get(draft.path)).toEqual(draft.pdf);
  });

  it("names a cover letter as one, in ASCII even for a name stored in Cyrillic", async () => {
    const t = createTestPreparation();
    const letter: DocumentToRender = {
      kind: "cover-letter", language: "bg", title: "Мира Петрова · Мотивационно писмо",
      content: {
        letterhead: { ...cv.letterhead, name: "Мира Петрова" }, date: "2026-10-13",
        recipient: { company: "Кестрел Плащания" }, re: { role: "Инженер по сигурност" },
        greeting: "Здравейте,", paragraphs: ["…"], closing: "Поздрави,",
      },
    };

    const draft = await t.preparation.draftDocument({
      packageId: "p1", document: letter, fileName: { name: "Мира Петрова", company: "Кестрел Плащания", role: "Инженер по сигурност" },
    });

    expect(draft.fileName).toBe("Mira_Petrova_Cover_Letter_Kestrel_Plashtaniya_Inzhener_po_sigurnost.pdf");
    expect(draft.ats).toBeNull();
  });
});

describe("the demo documents, for checking the template", () => {
  function recording() {
    const rendered: DocumentToRender[] = [];
    const t = createTestPreparation({ renderer: fakeRenderer((doc) => (rendered.push(doc), { pages: [{ lines: [doc.title] }] })) });
    return { t, rendered };
  }

  it("prints the fictional demo CV in Bulgarian with the photo slot on", async () => {
    const { t, rendered } = recording();

    const draft = await t.preparation.demoDocument({ kind: "cv", language: "bg", photo: true });

    expect(draft.fileName).toBe("Nia_Koleva_CV_Kestrel_Payments_Security_Engineer.pdf");
    expect(draft.path).toBe("packages/demo/Nia_Koleva_CV_Kestrel_Payments_Security_Engineer.pdf");
    const [doc] = rendered;
    expect(doc).toMatchObject({ kind: "cv", language: "bg", content: { letterhead: { name: "Ния Колева" } } });
    expect(doc!.kind === "cv" && doc!.content.photo).toMatchObject({ mediaType: "image/svg+xml" });
  });

  it("leaves the photo slot out unless it's switched on", async () => {
    const { t, rendered } = recording();

    await t.preparation.demoDocument({ kind: "cv", language: "en", photo: false });

    expect(rendered[0]).toMatchObject({ kind: "cv", language: "en", content: { letterhead: { name: "Nia Koleva" } } });
    expect(rendered[0]!.kind === "cv" && rendered[0]!.content.photo).toBeUndefined();
  });

  it("prints the demo cover letter with the CV's letterhead", async () => {
    const { t, rendered } = recording();

    const draft = await t.preparation.demoDocument({ kind: "cover-letter", language: "en", photo: false });

    expect(draft.fileName).toBe("Nia_Koleva_Cover_Letter_Kestrel_Payments_Security_Engineer.pdf");
    expect(rendered[0]).toMatchObject({
      kind: "cover-letter",
      content: { letterhead: { name: "Nia Koleva", headline: "Security Analyst" }, recipient: { company: "Kestrel Payments" }, re: { reference: "R-10482" } },
    });
  });
});
