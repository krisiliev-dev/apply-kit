import type { CvDocument, TextNode } from "@/lib/doc/types";
import type { ArchetypeMatch, ArchetypeReport } from "./types";
import { ARCHETYPE_BUNDLE } from "./archetypes";

// ————————————————————————————————————————————————
// Generic-archetype detector.
//
// Walks every visible text node, runs each archetype's regex variants against
// the content, and emits an `ArchetypeMatch` for every hit. Each match carries
// the category (drives severity bucketing) and a short suggested-replacement
// tactic, so the UI doesn't have to look anything up.
//
// Scoring rationale: we start at 100 and dock for unique phrase matches as a
// fraction of total visible text nodes. "Unique" means distinct phrases —
// ten bullets sharing the same "team player" cliché shouldn't score worse
// than one. A node with four+ hits still gets a per-match record so the UI
// can raise severity locally.
// ————————————————————————————————————————————————

export function detectArchetypes(doc: CvDocument): ArchetypeReport {
  const matches: ArchetypeMatch[] = [];
  const seenPhrases = new Set<string>();
  let totalTextNodes = 0;

  for (const node of iterTextNodes(doc)) {
    totalTextNodes++;
    const content = node.content;
    if (!content) continue;

    for (const entry of ARCHETYPE_BUNDLE) {
      for (const variant of entry.variants) {
        const m = variant.exec(content);
        if (!m) continue;
        matches.push({
          nodeId: node.id,
          category: entry.category,
          phrase: m[0], // the actual matched slice — user-facing
          suggestion: entry.suggestion,
        });
        seenPhrases.add(entry.phrase);
        break; // don't double-hit the same entry via sibling variants
      }
    }
  }

  const uniqueMatches = seenPhrases.size;
  // Ratio scoring — each unique phrase docks ~5 points up to a cap of 100.
  // Tuned to feel right on our seeded CVs: a writer variant with one cliche
  // scores ~95, a resume stuffed with 6+ drops below 70.
  const penalty = Math.min(100, uniqueMatches * 5);
  const score = clamp(100 - penalty, 0, 100);

  return {
    totalTextNodes,
    uniqueMatches,
    matches,
    score,
  };
}

// Compute per-node match counts — used by the UI to raise severity when a
// single node collects 3+ matches (the caller groups warnings by node first).
export function countMatchesPerNode(
  matches: ArchetypeMatch[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of matches) {
    counts.set(m.nodeId, (counts.get(m.nodeId) ?? 0) + 1);
  }
  return counts;
}

function* iterTextNodes(doc: CvDocument): Generator<TextNode> {
  for (const page of doc.pages) {
    for (const n of page.nodes) {
      if (n.type === "text" && !n.hidden) yield n;
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
