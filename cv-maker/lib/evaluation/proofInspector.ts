import type { CvDocument, TextNode } from "@/lib/doc/types";
import type { ProofInspectorReport, ProofMissingFlag } from "./types";

// ————————————————————————————————————————————————
// Proof-of-work inspector.
//
// Walks every text node; for nodes the editor has inferred (or the user has
// explicitly marked) as "bullets", we expect a `proofUrl` pointing to the
// underlying artifact: a commit, a published piece, a dashboard, a demo.
//
// The heuristic for "is this a bullet?" matches the numberInspector sibling:
//   • node.name starts with "Exp:" or contains ":bullet"
//   • content starts with "• " / "- " / "* " or every non-empty line does
//   • explicit override via `proofRequired` on the node
//
// Runs entirely client-side, no LLM. Cheap enough to fire on every keystroke
// which is what the EvalPanel / canvas warning pill do.
// ————————————————————————————————————————————————

const BULLET_MARKER_RE = /^\s*[•\-\*◦]\s+/;
const EXPERIENCE_NAME_RE = /(^|\W)(exp|experience|bullet|:bullet)(\W|$)/i;

export function inferProofRequired(node: TextNode): boolean {
  if (node.proofRequired !== undefined) return node.proofRequired;
  return heuristicIsBullet(node);
}

export function heuristicIsBullet(node: TextNode): boolean {
  const content = node.content?.trim() ?? "";
  if (!content) return false;
  if (node.name && EXPERIENCE_NAME_RE.test(node.name)) return true;
  if (BULLET_MARKER_RE.test(content)) return true;
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length >= 2 && lines.every((l) => BULLET_MARKER_RE.test(l))) {
    return true;
  }
  return false;
}

export function inspectProof(doc: CvDocument): ProofInspectorReport {
  let bulletsTotal = 0;
  let bulletsWithProof = 0;
  const missing: ProofMissingFlag[] = [];

  for (const node of iterTextNodes(doc)) {
    if (!inferProofRequired(node)) continue;
    bulletsTotal++;
    if (node.proofUrl && node.proofUrl.trim().length > 0) {
      bulletsWithProof++;
    } else {
      missing.push({
        nodeId: node.id,
        text: truncate(stripMarker(node.content).trim(), 140),
      });
    }
  }

  const score =
    bulletsTotal === 0
      ? 100
      : Math.round((bulletsWithProof / bulletsTotal) * 100);

  return {
    bulletsTotal,
    bulletsWithProof,
    missing,
    score,
  };
}

function* iterTextNodes(doc: CvDocument): Generator<TextNode> {
  for (const page of doc.pages) {
    for (const n of page.nodes) {
      if (n.type === "text" && !n.hidden) yield n;
    }
  }
}

function stripMarker(line: string): string {
  return line.replace(BULLET_MARKER_RE, "");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
