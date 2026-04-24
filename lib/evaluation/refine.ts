import { generateObject } from "ai";
import { z } from "zod";
import type { CvDocument, Node, TextNode } from "@/lib/doc/types";
import type { ParsedJob } from "@/lib/app/types";
import type { Settings } from "@/lib/settings/types";
import type { CvEvaluation, EvalWarning } from "./types";
import { evaluateCv, type ProgressUpdate } from "./evaluate";
import { resolveModel } from "@/lib/ai/provider";

// ————————————————————————————————————————————————
// Iterative refinement.
//
// Loop:
//   1. Evaluate current doc.
//   2. If overall < targetScore AND iteration < maxIterations:
//      • Ask the LLM to propose a targeted patch (a list of text-node edits)
//        that addresses the current warnings
//      • Apply patch → re-evaluate
//   3. Return the best-scoring variant across all iterations, plus the full
//      trace so the UI can diff / pick.
//
// Design note: we intentionally don't let the model rewrite the whole doc.
// The editor is the user's thing. We only allow:
//   • Rewriting text-node content (TextNode.content) by id
//   • Adding or removing nothing else
// Anything bigger is a job for the human + chat copilot.
// ————————————————————————————————————————————————

export const DEFAULT_TARGET_SCORE = 80;
export const DEFAULT_MAX_ITERATIONS = 3;

export type RefinementIteration = {
  index: number; // 0-based
  doc: CvDocument;
  evaluation: CvEvaluation;
  appliedEdits: TextEdit[];
};

export type RefineResult = {
  best: RefinementIteration;
  iterations: RefinementIteration[];
};

export type TextEdit = {
  nodeId: string;
  newContent: string;
  reason: string;
};

export type RefineOptions = {
  doc: CvDocument;
  job: ParsedJob | null;
  maxIterations?: number;
  targetScore?: number;
  settings?: Settings;
};

export type RefineProgressUpdate =
  | { kind: "stage"; iteration: number; stage: ProgressUpdate["stage"]; message: string }
  | {
      kind: "iteration-done";
      iteration: number;
      score: number;
      delta: number;
      warningCount: number;
    }
  | { kind: "refining"; iteration: number; message: string }
  | { kind: "done"; message: string };

export async function refineCv(
  opts: RefineOptions,
  onProgress?: (p: RefineProgressUpdate) => void,
): Promise<RefineResult> {
  const target = opts.targetScore ?? DEFAULT_TARGET_SCORE;
  const maxIter = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const emit = (p: RefineProgressUpdate) => {
    try {
      onProgress?.(p);
    } catch {
      // ignore
    }
  };

  const iterations: RefinementIteration[] = [];
  let currentDoc = opts.doc;

  for (let i = 0; i < maxIter; i++) {
    const evaluation = await evaluateCv(
      { doc: currentDoc, job: opts.job, settings: opts.settings },
      (p) => emit({ kind: "stage", iteration: i, stage: p.stage, message: p.message }),
    );

    const prev = iterations[iterations.length - 1];
    const delta = prev ? evaluation.overall - prev.evaluation.overall : 0;

    const iter: RefinementIteration = {
      index: i,
      doc: currentDoc,
      evaluation,
      appliedEdits:
        i === 0
          ? []
          : (iterations[iterations.length - 1]?.appliedEdits ?? []),
    };
    iterations.push(iter);
    emit({
      kind: "iteration-done",
      iteration: i,
      score: evaluation.overall,
      delta,
      warningCount: evaluation.warnings.length,
    });

    if (evaluation.overall >= target) break;
    if (i === maxIter - 1) break;

    emit({
      kind: "refining",
      iteration: i,
      message: `Proposing fixes for iteration ${i + 2}/${maxIter}…`,
    });

    const edits = await proposeFixes({
      doc: currentDoc,
      evaluation,
      job: opts.job,
      settings: opts.settings,
    });

    if (edits.length === 0) {
      // Nothing useful to change — exit early rather than burn another round
      break;
    }

    currentDoc = applyTextEdits(currentDoc, edits);

    // Record the edits on the next iteration so the trace carries them.
    if (iterations[iterations.length - 1]) {
      iterations[iterations.length - 1].appliedEdits = edits;
    }
  }

  const best = iterations.reduce((a, b) =>
    b.evaluation.overall > a.evaluation.overall ? b : a,
  );

  emit({
    kind: "done",
    message: `Best overall ${best.evaluation.overall}/100 after ${iterations.length} iteration(s).`,
  });

  return { best, iterations };
}

// ————————————————————————————————————————————————
// Fix proposal — ask the LLM for text-edit patches given current warnings.
// ————————————————————————————————————————————————

const editSchema = z.object({
  edits: z
    .array(
      z.object({
        nodeId: z.string().describe("The id of the text node to rewrite."),
        newContent: z
          .string()
          .describe("The new text content for the node. Preserve newlines where appropriate."),
        reason: z
          .string()
          .describe("One short sentence explaining which warning this addresses."),
      }),
    )
    .describe("Up to 8 targeted text-node rewrites. Skip the list if no edits would help."),
});

type FixInput = {
  doc: CvDocument;
  evaluation: CvEvaluation;
  job: ParsedJob | null;
  settings?: Settings;
};

async function proposeFixes(input: FixInput): Promise<TextEdit[]> {
  let model;
  try {
    // `draft` is the feature class for the refine loop — same prose-polish
    // work as the original drafting call. This keeps the refine loop honest
    // about inheriting the user's drafting-quality/speed choice.
    model = resolveModel("draft", input.settings);
  } catch {
    // No configured provider (e.g. Anthropic key missing and Anthropic
    // selected). Skip refinement rather than blowing up the whole evaluate
    // path.
    return [];
  }

  try {
    const { object } = await generateObject({
      model,
      schema: editSchema,
      schemaName: "CvFixProposal",
      schemaDescription:
        "Targeted text-node rewrites to address specific CV evaluation warnings.",
      system: buildRefineSystemPrompt(),
      prompt: buildRefinePrompt(input),
    });

    const ids = new Set(
      input.doc.pages.flatMap((p) => p.nodes.map((n) => n.id)),
    );
    return object.edits.filter(
      (e) => ids.has(e.nodeId) && e.newContent.trim().length > 0,
    );
  } catch {
    return [];
  }
}

function buildRefineSystemPrompt(): string {
  return `You're improving a CV against specific warnings from an ATS-style evaluator.

Rules:
  • You edit TEXT NODES ONLY by id. You cannot move them, resize them, or change layout.
  • You must NOT invent companies, roles, dates, metrics, or accomplishments.
  • Prefer rewording over expansion. Keep the spirit of the original text.
  • For parse warnings (missing email/phone/name/etc.) make sure the relevant node contains clean, parseable text (e.g. "jane@example.com" on its own or labeled clearly).
  • For missing-keyword warnings: only surface a keyword if the user actually has the experience. If not, leave it.
  • For recruiter-flagged buzzwords / over-claiming: compress and make concrete, citing what's already in the text.
  • Return ONLY the edits you're sure will help. Fewer high-impact edits beat many marginal ones.`;
}

function buildRefinePrompt(input: FixInput): string {
  const textNodeSummary = flattenTextNodes(input.doc);
  const parts: string[] = [];

  parts.push(`Target role: ${input.doc.targetRole}`);
  if (input.job) {
    parts.push(`Job: ${input.job.title} at ${input.job.company}`);
    if (input.job.keywords?.length) {
      parts.push(`Job keywords: ${input.job.keywords.slice(0, 20).join(", ")}`);
    }
  }
  parts.push("");
  parts.push(`Current overall score: ${input.evaluation.overall}/100`);
  parts.push(
    `  parseability ${input.evaluation.parseability.score} / keywords ${input.evaluation.keywords.score} / recruiter odds ${input.evaluation.recruiter.interviewOdds}`,
  );
  parts.push("");
  parts.push("Warnings to address (ordered — earlier is more important):");
  for (const w of pickActionableWarnings(input.evaluation.warnings)) {
    parts.push(`  [${w.layer}:${w.kind}] ${w.message}`);
  }
  parts.push("");
  parts.push("Text nodes available to edit (id | content):");
  for (const n of textNodeSummary) {
    const snippet = n.content.length > 180 ? n.content.slice(0, 180) + "…" : n.content;
    parts.push(`  ${n.id} | ${snippet.replace(/\n/g, " ⏎ ")}`);
  }

  return parts.join("\n");
}

function pickActionableWarnings(warnings: EvalWarning[]): EvalWarning[] {
  const order: EvalWarning["severity"][] = ["error", "warn", "info"];
  return [...warnings].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
  );
}

type FlatText = { id: string; content: string };

function flattenTextNodes(doc: CvDocument): FlatText[] {
  const out: FlatText[] = [];
  for (const p of doc.pages) {
    for (const n of p.nodes) {
      if (n.type === "text" && !n.hidden) {
        out.push({ id: n.id, content: n.content });
      }
    }
  }
  return out;
}

// ————————————————————————————————————————————————
// Apply text edits immutably.
// ————————————————————————————————————————————————

export function applyTextEdits(doc: CvDocument, edits: TextEdit[]): CvDocument {
  if (edits.length === 0) return doc;
  const byId = new Map(edits.map((e) => [e.nodeId, e]));
  return {
    ...doc,
    pages: doc.pages.map((p) => ({
      ...p,
      nodes: p.nodes.map((n) => applyToNode(n, byId.get(n.id))),
    })),
    updatedAt: Date.now(),
  };
}

function applyToNode(node: Node, edit: TextEdit | undefined): Node {
  if (!edit) return node;
  if (node.type !== "text") return node;
  return { ...node, content: edit.newContent } satisfies TextNode;
}
