import type { CvDocument, TextNode } from "@/lib/doc/types";
import type { AffindaExtracted } from "./types";

// ————————————————————————————————————————————————
// Fuzzy text → node id mapping.
//
// Used by:
//   • the parseability heatmap (which nodes did the parser successfully
//     extract, which didn't)
//   • keyword-warning targeting (where in the doc should "missing: react"
//     point to — closest match wins)
//
// Matching is deliberately loose: case-insensitive substring first,
// then token-overlap for longer strings. Not perfect — acceptable.
// ————————————————————————————————————————————————

type LocateMap = Map<string, string[]>;

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function allTextNodes(doc: CvDocument): TextNode[] {
  return doc.pages.flatMap((p) =>
    p.nodes.filter((n): n is TextNode => n.type === "text" && !n.hidden),
  );
}

// Returns ids where the needle appears (substring).
export function nodesContaining(doc: CvDocument, needle: string): string[] {
  const n = norm(needle);
  if (!n) return [];
  const out: string[] = [];
  for (const node of allTextNodes(doc)) {
    if (norm(node.content).includes(n)) out.push(node.id);
  }
  return out;
}

// For a set of needles, map each → the node ids that contain it.
export function fuzzyLocateNodes(
  doc: CvDocument,
  needles: string[],
): LocateMap {
  const map: LocateMap = new Map();
  for (const needle of needles) {
    map.set(needle, nodesContaining(doc, needle));
  }
  return map;
}

// ————————————————————————————————————————————————
// Parser coverage map — for the heatmap overlay.
//
// For each node, decide whether its content shows up in Affinda's extracted
// fields. If yes, the node renders as "parsed green". If it contains email-
// like / phone-like / name-like text that SHOULD have been extracted but
// wasn't, we mark it red (unextracted-but-should-be).
// ————————————————————————————————————————————————

export type ParserCoverage = {
  extractedNodeIds: string[];
  unextractedExtractableNodeIds: string[];
};

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/;
const NAME_LIKE_RE = /^[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){1,3}$/;

export function computeParserCoverage(
  doc: CvDocument,
  extracted: AffindaExtracted,
): ParserCoverage {
  const extractedIds = new Set<string>();
  const unextractedIds = new Set<string>();

  const parsedTexts = collectParsedTexts(extracted);

  for (const node of allTextNodes(doc)) {
    const content = node.content.trim();
    if (!content) continue;
    const nlow = norm(content);

    // Extracted match — any parsed string is a substring of the node OR vice
    // versa (short fields like an email live inside a bigger name+email line).
    let matched = false;
    for (const t of parsedTexts) {
      if (!t) continue;
      if (nlow.includes(t) || t.includes(nlow)) {
        matched = true;
        break;
      }
    }

    if (matched) {
      extractedIds.add(node.id);
      continue;
    }

    // Not matched — is it something the parser SHOULD have extracted?
    if (EMAIL_RE.test(content) && !extracted.email) {
      unextractedIds.add(node.id);
      continue;
    }
    if (PHONE_RE.test(content) && !extracted.phone) {
      unextractedIds.add(node.id);
      continue;
    }
    if (NAME_LIKE_RE.test(content.slice(0, 80)) && !extracted.name) {
      unextractedIds.add(node.id);
      continue;
    }
  }

  return {
    extractedNodeIds: [...extractedIds],
    unextractedExtractableNodeIds: [...unextractedIds],
  };
}

function collectParsedTexts(extracted: AffindaExtracted): string[] {
  const out: string[] = [];
  if (extracted.name) out.push(norm(extracted.name));
  if (extracted.email) out.push(norm(extracted.email));
  if (extracted.phone) out.push(norm(extracted.phone));
  if (extracted.location) out.push(norm(extracted.location));
  if (extracted.summary) out.push(norm(extracted.summary).slice(0, 120));
  for (const w of extracted.workExperience) {
    if (w.title) out.push(norm(w.title));
    if (w.company) out.push(norm(w.company));
    for (const b of w.bullets ?? []) out.push(norm(b).slice(0, 100));
  }
  for (const e of extracted.education) {
    if (e.school) out.push(norm(e.school));
    if (e.degree) out.push(norm(e.degree));
  }
  for (const s of extracted.skills) out.push(norm(s));
  return out.filter((s) => s.length >= 3);
}
