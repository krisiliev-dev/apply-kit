import type { CvDocument, Node, TextNode } from "@/lib/doc/types";
import type { CVContent } from "@/lib/types";
import { cvs } from "@/content/cvs";

// ————————————————————————————————————————————————
// Plain-text ATS export.
//
// Applicant-tracking systems re-flow documents into a flat text stream. Two-
// column layouts, decorative shapes, and creative section labels all confuse
// them. This module produces a conservative, parser-friendly text block with
// standard headings and a predictable reading order.
//
// Two paths:
//   1. Typed content (preferred): if `doc.slug` matches a registered CVContent
//      in `content/cvs/index.ts`, we render directly from the typed object.
//      Output is cleaner and stable across editor tweaks.
//   2. DOM inference: walk the nodes in reading order (sort by Y then X),
//      group bullets under their nearest preceding section heading, and
//      reformat into a flat document. Works for any hand-edited doc.
// ————————————————————————————————————————————————

export type AtsTextOptions = {
  /**
   * When provided and `content.slug === doc.slug`, we render from the typed
   * content instead of walking nodes. Caller can look this up themselves or
   * leave undefined and we'll auto-match against the static registry.
   */
  content?: CVContent;
};

export function toAtsText(doc: CvDocument, opts: AtsTextOptions = {}): string {
  const content =
    opts.content ?? (doc.slug in cvs ? cvs[doc.slug] : undefined);
  if (content) return fromTypedContent(content);
  return fromDocInference(doc);
}

// ————————————————————————————————————————————————
// Path 1 — typed content
// ————————————————————————————————————————————————

function fromTypedContent(cv: CVContent): string {
  const out: string[] = [];
  const { profile } = cv;

  out.push(profile.name.toUpperCase());

  const contact = [
    profile.email,
    profile.phone,
    profile.location,
    ...(profile.links?.map((l) => `${l.label}: ${l.href}`) ?? []),
  ].filter(Boolean);
  if (contact.length > 0) out.push(contact.join(" · "));

  if (profile.title) {
    out.push("", profile.title);
  }

  if (profile.summary) {
    out.push("", "SUMMARY", profile.summary);
  }

  if (cv.experiences.length > 0) {
    out.push("", "EXPERIENCE");
    for (const exp of cv.experiences) {
      const headerPieces = [
        exp.role,
        exp.company && `— ${exp.company}`,
        exp.location && `(${exp.location})`,
        `· ${exp.dates.start}–${exp.dates.end}`,
      ].filter(Boolean);
      out.push("", headerPieces.join(" "));
      if (exp.summary) out.push(exp.summary);
      for (const b of exp.bullets ?? []) {
        out.push(`  • ${b}`);
      }
    }
  }

  if (cv.education.length > 0) {
    out.push("", "EDUCATION");
    for (const e of cv.education) {
      const line = [
        e.degree,
        e.school && `— ${e.school}`,
        e.location && `(${e.location})`,
        `· ${e.dates.start}–${e.dates.end}`,
      ].filter(Boolean);
      out.push("", line.join(" "));
      if (e.notes) out.push(e.notes);
    }
  }

  if (cv.skills && cv.skills.length > 0) {
    out.push("", "SKILLS");
    for (const g of cv.skills) {
      out.push(`${g.label}: ${g.items.join(", ")}`);
    }
  }

  if (cv.projects && cv.projects.length > 0) {
    out.push("", "PROJECTS");
    for (const p of cv.projects) {
      const parts = [p.name, `— ${p.summary}`];
      if (p.url) parts.push(`· ${p.url}`);
      out.push("", parts.join(" "));
      if (p.stack && p.stack.length > 0) {
        out.push(`Stack: ${p.stack.join(", ")}`);
      }
    }
  }

  if (cv.interests && cv.interests.length > 0) {
    out.push("", "INTERESTS", cv.interests.join(", "));
  }

  return normalize(out.join("\n"));
}

// ————————————————————————————————————————————————
// Path 2 — doc inference
// ————————————————————————————————————————————————

type SectionKey =
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "projects"
  | "interests"
  | "other";

const SECTION_SYNONYMS: Record<SectionKey, string[]> = {
  summary: ["summary", "about", "profile", "objective"],
  experience: ["experience", "work", "employment", "history"],
  education: ["education", "academic", "qualifications"],
  skills: ["skills", "stack", "toolkit", "tools", "technologies"],
  projects: ["projects", "side projects", "selected work", "work"],
  interests: ["interests", "also", "hobbies", "outside"],
  other: [],
};

type TextLike = { text: string; y: number; x: number; fontSize: number };

function fromDocInference(doc: CvDocument): string {
  const page = doc.pages[0];
  if (!page) return "";

  // Collect text nodes in reading order.
  const texts: Array<TextLike & { node: TextNode }> = [];
  for (const n of page.nodes) {
    if (!isText(n)) continue;
    if (n.hidden) continue;
    const content = n.content?.trim();
    if (!content) continue;
    texts.push({
      text: content,
      y: n.y,
      x: n.x,
      fontSize: n.style.fontSize,
      node: n,
    });
  }
  // Reading order: top-to-bottom, ties broken left-to-right.
  texts.sort((a, b) => {
    const dy = a.y - b.y;
    if (Math.abs(dy) > 3) return dy;
    return a.x - b.x;
  });

  // First non-tiny node we assume is the name. If a node has the largest
  // font size and sits in the first third of the page, treat it as the name.
  const header: string[] = [];
  const maxFont = Math.max(...texts.map((t) => t.fontSize), 0);
  const nameIdx = texts.findIndex(
    (t) => t.fontSize >= maxFont * 0.8 && t.y < (page.height ?? 297) / 2,
  );
  if (nameIdx >= 0) {
    header.push(texts[nameIdx].text.toUpperCase());
  }

  // Contact line: a mono-looking meta node near the name (small font, same
  // neighborhood). Accept anything with an @ / http / + digit.
  const contactIdx = texts.findIndex((t, i) => {
    if (i === nameIdx) return false;
    return (
      t.y < (page.height ?? 297) / 3 &&
      /[@]|https?:\/\/|\+\d/.test(t.text)
    );
  });
  if (contactIdx >= 0) header.push(texts[contactIdx].text);

  // Group the rest by section.
  const sections = new Map<SectionKey, string[]>();
  let current: SectionKey = "other";

  const startSection = (key: SectionKey) => {
    current = key;
    if (!sections.has(key)) sections.set(key, []);
  };

  for (let i = 0; i < texts.length; i++) {
    if (i === nameIdx || i === contactIdx) continue;
    const t = texts[i];
    const heading = detectHeading(t);
    if (heading) {
      startSection(heading);
      continue;
    }
    const bucket = sections.get(current) ?? [];
    // Bullets keep their leading dot/bullet markers.
    bucket.push(t.text);
    sections.set(current, bucket);
  }

  const out: string[] = [...header];

  const emitSection = (label: string, key: SectionKey) => {
    const lines = sections.get(key);
    if (!lines || lines.length === 0) return;
    out.push("", label);
    for (const l of lines) out.push(l);
  };

  emitSection("SUMMARY", "summary");
  emitSection("EXPERIENCE", "experience");
  emitSection("EDUCATION", "education");
  emitSection("SKILLS", "skills");
  emitSection("PROJECTS", "projects");
  emitSection("INTERESTS", "interests");

  const otherLines = sections.get("other");
  if (otherLines && otherLines.length > 0) {
    // Skip lines already emitted as header (name / contact).
    out.push("", "OTHER");
    for (const l of otherLines) out.push(l);
  }

  return normalize(out.join("\n"));
}

function detectHeading(t: TextLike): SectionKey | null {
  // A short, small-font, uppercase-styled line is almost always a heading.
  // We lean on the token rather than computed CSS — the node name hint is
  // another signal, but this fn receives only the text.
  const raw = t.text.trim();
  if (raw.length > 28) return null;
  const lc = raw.toLowerCase();
  for (const [k, synonyms] of Object.entries(SECTION_SYNONYMS) as [
    SectionKey,
    string[],
  ][]) {
    if (synonyms.includes(lc)) return k;
  }
  return null;
}

function isText(n: Node): n is TextNode {
  return n.type === "text";
}

// Collapses more than one blank line and trims trailing whitespace.
function normalize(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/\s+$/u, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}

// ————————————————————————————————————————————————
// Download helper — used by the editor toolbar.
// ————————————————————————————————————————————————

export function downloadAtsText(doc: CvDocument, opts: AtsTextOptions = {}) {
  if (typeof window === "undefined") return;
  const text = toAtsText(doc, opts);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.slug || "cv"}-plain.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
