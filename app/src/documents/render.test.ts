// Smoke test: the real templates printed by headless Chromium and read back with pdf.js. Skipped,
// with a message, where Playwright's Chromium isn't installed.
import { afterAll, describe, expect, it } from "vitest";
import {
  checkAts, demoDocument, documentFileName, formatRange, sectionTitles, cvSections,
  type CvContent, type DocumentLanguage, type DocumentToRender, type PdfText,
} from "@apply-kit/core";
import { chromiumInstalled, createChromiumRenderer } from "./chromium.ts";
import { readPdfText } from "./pdf-text.ts";

const available = chromiumInstalled();
if (!available) console.warn("Skipping the PDF rendering smoke test: Chromium isn't installed (pnpm --filter @apply-kit/app exec playwright install chromium-headless-shell)");

/** Every field of a CV in the order a reader meets it. */
function fieldsInOrder(c: CvContent, language: DocumentLanguage): string[] {
  const h = c.letterhead;
  const titles = sectionTitles[language];
  const sections: Record<(typeof cvSections)[number], string[]> = {
    summary: [c.summary],
    experience: c.experience.flatMap((r) => [`${r.title} · ${r.employer}, ${r.place}`, formatRange(r.start, r.end, language), ...r.bullets]),
    skills: c.skills,
    education: c.education.flatMap((e) => [`${e.degree} · ${e.school}`, formatRange(e.start, e.end, language)]),
    languages: c.languagesAndCourses,
  };
  return [
    h.name, h.headline, h.location!, h.email, h.phone!, ...h.links,
    ...cvSections.flatMap((s) => [titles[s], ...sections[s]]),
  ];
}

/** The fields that aren't where they should be: each must come after the one before it. */
function outOfOrder(text: PdfText, fields: string[]): string[] {
  const squash = (s: string) => s.toLocaleLowerCase("bg").replace(/\s+/g, "");
  const all = squash(text.pages.flatMap((p) => p.lines).join(" "));
  const lost: string[] = [];
  let from = 0;
  for (const f of fields) {
    const at = all.indexOf(squash(f), from);
    if (at < 0) lost.push(f);
    else from = at + squash(f).length;
  }
  return lost;
}

const latin1 = (pdf: Uint8Array) => Buffer.from(pdf).toString("latin1");

describe.skipIf(!available)("the CV template printed by Chromium", () => {
  const renderer = createChromiumRenderer();
  afterAll(() => renderer.close());

  it.each([
    ["English", { kind: "cv", language: "en", photo: false }],
    ["Bulgarian", { kind: "cv", language: "bg", photo: false }],
    ["English with photo", { kind: "cv", language: "en", photo: true }],
  ] as const)("prints the %s CV on one page, every field reading back in order", async (_name, options) => {
    const doc = demoDocument(options) as Extract<DocumentToRender, { kind: "cv" }>;

    const { pdf, pages } = await renderer.render(doc);
    const text = await readPdfText(pdf);

    expect(pages).toBe(1);
    expect(outOfOrder(text, fieldsInOrder(doc.content, doc.language))).toEqual([]);
    const fileName = documentFileName("cv", { name: "Nia Koleva", company: "Kestrel Payments", role: "Security Engineer" });
    expect(checkAts({ text, document: doc, fileName }).checks.filter((c) => !c.passed)).toEqual([]);
  }, 30_000);

  it("embeds its fonts and tags the PDF with its language and title", async () => {
    const doc = demoDocument({ kind: "cv", language: "bg", photo: false });

    const raw = latin1((await renderer.render(doc)).pdf);

    expect(raw).toMatch(/\/FontFile[23]?/);
    expect(raw).toMatch(/Onest/);
    expect(raw).toMatch(/Geologica/);
    expect(raw).toMatch(/\/StructTreeRoot/);
    expect(raw).toMatch(/\/Lang\s*\(bg\)/);
  }, 30_000);

  it("runs long content onto page 2 rather than shrinking it", async () => {
    const doc = demoDocument({ kind: "cv", language: "en", photo: false }) as Extract<DocumentToRender, { kind: "cv" }>;
    const long = { ...doc, content: { ...doc.content, experience: [...doc.content.experience, ...doc.content.experience, ...doc.content.experience] } };

    const { pdf, pages } = await renderer.render(long);
    const text = await readPdfText(pdf);

    expect(pages).toBe(2);
    // The page holds as many lines as ever: nothing got smaller to fit more.
    expect(text.pages[0]!.lines.length).toBeLessThan(60);
  }, 30_000);

  it("prints the cover letter on one page with the CV's letterhead and the job's Re: line", async () => {
    const doc = demoDocument({ kind: "cover-letter", language: "en", photo: false });

    const { pdf, pages } = await renderer.render(doc);
    const lines = (await readPdfText(pdf)).pages.flatMap((p) => p.lines);

    expect(pages).toBe(1);
    expect(lines.slice(0, 2)).toEqual(["Nia Koleva", "Security Analyst"]);
    expect(lines).toContain("13 October 2026");
    expect(lines).toContain("Re: Security Engineer (R-10482)");
    expect(lines.at(-1)).toBe("Nia Koleva");
  }, 30_000);
});
