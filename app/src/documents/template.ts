// The fixed document templates (ADR 0003): one HTML page per CV or cover letter, filled from
// structured content (the model never writes markup), styled by the shared `.doc` component and the
// `--doc-*` print tokens from app/ui/src/styles, with the fonts embedded from local files. The
// layout never depends on the content: long content runs onto page 2 and is reported, never shrunk.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cvSections, formatLetterDate, formatRange, letterLabels, sectionTitles,
  type CvContent, type CvSection, type DocumentLanguage, type DocumentToRender, type Letterhead, type LetterContent,
} from "@apply-kit/core";

const stylesDir = join(dirname(fileURLToPath(import.meta.url)), "../../ui/src/styles");
const require = createRequire(import.meta.url);

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Geologica (names, headings) and Onest (text), Latin and Cyrillic, embedded as data: no fetch at render time. */
function embeddedFonts(): string {
  const faces: string[] = [];
  const fonts: [string, number[]][] = [["onest", [400, 500, 600, 700]], ["geologica", [600, 700]]];
  for (const [family, weights] of fonts) {
    for (const subset of ["latin", "latin-ext", "cyrillic", "cyrillic-ext"]) {
      for (const weight of weights) {
        const cssPath = require.resolve(`@fontsource/${family}/${subset}-${weight}.css`);
        const css = readFileSync(cssPath, "utf8").replace(
          /src:\s*url\(\.\/files\/([^)]+\.woff2)\) format\('woff2'\)[^;]*;/g,
          (_m, file: string) => `src: url(data:font/woff2;base64,${readFileSync(join(dirname(cssPath), "files", file)).toString("base64")}) format('woff2');`,
        );
        faces.push(css);
      }
    }
  }
  return faces.join("\n");
}

let styles: string | undefined;

/** Tokens, the shared components (the `.doc` page among them), and what changes when the page is paper. */
function documentStyles(): string {
  if (styles) return styles;
  const tokens = readFileSync(join(stylesDir, "tokens.css"), "utf8");
  const components = readFileSync(join(stylesDir, "components.css"), "utf8");
  // @page can't read custom properties, so the margin token's value is copied in.
  const margin = /--doc-margin:\s*([^;]+);/.exec(tokens)?.[1]?.trim();
  if (!margin) throw new Error("tokens.css has no --doc-margin");
  const paper = `
@page { size: A4; margin: ${margin} }
html, body { background: var(--doc-paper) }
.doc { width: auto; min-height: 0; padding: 0; border-radius: 0; box-shadow: none }
.doc .d-photo { object-fit: cover }
.doc li { break-inside: avoid }
.doc .d-line { break-after: avoid }
`;
  styles = [embeddedFonts(), tokens, components, paper].join("\n");
  return styles;
}

function letterheadHtml(h: Letterhead, photo?: CvContent["photo"]): string {
  const contact = [h.location, h.email, h.phone, ...h.links].filter(Boolean).map((s) => `<span>${escape(s!)}</span>`).join(" · ");
  const img = photo
    ? `<img class="d-photo" alt="" src="data:${photo.mediaType};base64,${Buffer.from(photo.bytes).toString("base64")}">`
    : "";
  return `<header class="d-head"><p class="d-name">${escape(h.name)}</p><span class="d-role">${escape(h.headline)}</span><span class="d-contact">${contact}</span>${img}</header>`;
}

function cvBody(c: CvContent, language: DocumentLanguage): string {
  const titles = sectionTitles[language];
  const line = (left: string, when: string) => `<div class="d-line"><b>${escape(left)}</b><span class="d-when">${escape(when)}</span></div>`;
  const sections: Record<CvSection, string | null> = {
    summary: c.summary.trim() ? `<p>${escape(c.summary)}</p>` : null,
    experience: c.experience.length === 0 ? null : c.experience.map((r) => {
      const heading = `${r.title} · ${r.employer}${r.place ? `, ${r.place}` : ""}`;
      const bullets = r.bullets.length ? `<ul>${r.bullets.map((b) => `<li>${escape(b)}</li>`).join("")}</ul>` : "";
      return `<div class="d-item">${line(heading, formatRange(r.start, r.end, language))}${bullets}</div>`;
    }).join(""),
    skills: c.skills.length ? `<p>${c.skills.map(escape).join(" · ")}</p>` : null,
    education: c.education.length === 0 ? null : c.education.map((e) => line(`${e.degree} · ${e.school}`, formatRange(e.start, e.end, language))).join(""),
    languages: c.languagesAndCourses.length ? `<p>${c.languagesAndCourses.map(escape).join(" · ")}</p>` : null,
  };
  return letterheadHtml(c.letterhead, c.photo) + cvSections
    .filter((s) => sections[s] !== null)
    .map((s) => `<section><h2>${escape(titles[s])}</h2>${sections[s]}</section>`)
    .join("");
}

function letterBody(c: LetterContent, language: DocumentLanguage): string {
  const labels = letterLabels[language];
  const recipient = [labels.recipient, c.recipient.company, c.recipient.place].filter(Boolean).map((s) => escape(s!)).join("<br>");
  const re = `${labels.re} ${c.re.role}${c.re.reference ? ` (${c.re.reference})` : ""}`;
  const paragraphs = [c.greeting, ...c.paragraphs].map((p) => `<p>${escape(p)}</p>`).join("");
  return letterheadHtml(c.letterhead)
    + `<div class="d-letter stack" style="gap:var(--doc-gap-section)">`
    + `<p class="d-muted">${escape(formatLetterDate(c.date, language))}</p>`
    + `<p>${recipient}</p><p><b>${escape(re)}</b></p>${paragraphs}`
    + `<p>${escape(c.closing)}<br>${escape(c.letterhead.name)}</p></div>`;
}

/** The whole page for one document, ready to print. */
export function documentHtml(doc: DocumentToRender): string {
  const body = doc.kind === "cv" ? cvBody(doc.content, doc.language) : letterBody(doc.content, doc.language);
  return `<!doctype html><html lang="${doc.language}"><head><meta charset="utf-8"><title>${escape(doc.title)}</title>`
    + `<style>${documentStyles()}</style></head><body><article class="doc" lang="${doc.language}">${body}</article></body></html>`;
}
