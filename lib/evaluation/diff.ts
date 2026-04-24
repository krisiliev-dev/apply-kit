import { diffWords } from "diff";
import type { CvDocument, Node } from "@/lib/doc/types";
import type { CvEvaluation } from "./types";

// ————————————————————————————————————————————————
// Before/after diff view.
//
// Given two CvDocuments, reports which nodes changed and (for text) a
// word-level diff of before vs after. Also computes layer-by-layer score
// deltas when two evaluations are provided.
// ————————————————————————————————————————————————

export type NodeDiff = {
  nodeId: string;
  kind: "added" | "removed" | "changed" | "unchanged";
  before?: Node;
  after?: Node;
  /** Word-level diff chunks for text nodes. */
  textChunks?: DiffChunk[];
};

export type DiffChunk = {
  value: string;
  added?: boolean;
  removed?: boolean;
};

export type ScoreDelta = {
  overall: number;
  parseability: number;
  keywords: number;
  recruiter: number;
};

export type DocDiff = {
  nodeDiffs: NodeDiff[];
  changedCount: number;
  addedCount: number;
  removedCount: number;
  scoreDelta: ScoreDelta | null;
};

export function diffDocuments(
  before: CvDocument,
  after: CvDocument,
  beforeEval?: CvEvaluation,
  afterEval?: CvEvaluation,
): DocDiff {
  const beforeNodes = new Map<string, Node>();
  for (const p of before.pages) {
    for (const n of p.nodes) beforeNodes.set(n.id, n);
  }
  const afterNodes = new Map<string, Node>();
  for (const p of after.pages) {
    for (const n of p.nodes) afterNodes.set(n.id, n);
  }

  const allIds = new Set<string>([...beforeNodes.keys(), ...afterNodes.keys()]);
  const nodeDiffs: NodeDiff[] = [];

  let changedCount = 0;
  let addedCount = 0;
  let removedCount = 0;

  for (const id of allIds) {
    const b = beforeNodes.get(id);
    const a = afterNodes.get(id);

    if (!b && a) {
      addedCount++;
      nodeDiffs.push({ nodeId: id, kind: "added", after: a });
      continue;
    }
    if (b && !a) {
      removedCount++;
      nodeDiffs.push({ nodeId: id, kind: "removed", before: b });
      continue;
    }
    if (b && a) {
      const kind = nodeEquals(b, a) ? "unchanged" : "changed";
      if (kind === "changed") changedCount++;

      const textChunks =
        b.type === "text" && a.type === "text"
          ? diffText(b.content, a.content)
          : undefined;

      nodeDiffs.push({ nodeId: id, kind, before: b, after: a, textChunks });
    }
  }

  return {
    nodeDiffs,
    changedCount,
    addedCount,
    removedCount,
    scoreDelta:
      beforeEval && afterEval ? computeScoreDelta(beforeEval, afterEval) : null,
  };
}

function nodeEquals(a: Node, b: Node): boolean {
  if (a.type !== b.type) return false;
  if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h) return false;
  if ((a.rotation ?? 0) !== (b.rotation ?? 0)) return false;
  if ((a.opacity ?? 1) !== (b.opacity ?? 1)) return false;
  if (a.type === "text" && b.type === "text") {
    return a.content === b.content;
  }
  if (a.type === "image" && b.type === "image") {
    return a.src === b.src;
  }
  if (a.type === "shape" && b.type === "shape") {
    return (
      a.shape === b.shape &&
      a.fill === b.fill &&
      a.stroke === b.stroke &&
      a.strokeWidth === b.strokeWidth
    );
  }
  return true;
}

function diffText(before: string, after: string): DiffChunk[] {
  const parts = diffWords(before, after);
  return parts.map((p) => ({
    value: p.value,
    added: p.added ? true : undefined,
    removed: p.removed ? true : undefined,
  }));
}

function computeScoreDelta(
  before: CvEvaluation,
  after: CvEvaluation,
): ScoreDelta {
  const recruiterScore = (e: CvEvaluation) => {
    if (e.recruiter.unavailable) return 60;
    const base =
      e.recruiter.interviewOdds === "Low"
        ? 35
        : e.recruiter.interviewOdds === "Mid"
          ? 65
          : 85;
    return Math.max(0, base - Math.min(e.recruiter.flaggedIssues.length * 3, 15));
  };

  return {
    overall: after.overall - before.overall,
    parseability: after.parseability.score - before.parseability.score,
    keywords: after.keywords.score - before.keywords.score,
    recruiter: recruiterScore(after) - recruiterScore(before),
  };
}
