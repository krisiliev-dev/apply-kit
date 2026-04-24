import { nanoid } from "nanoid";
import type { CvDocument } from "@/lib/doc/types";
import type { ParsedJob } from "@/lib/app/types";
import type {
  AffindaResult,
  CvEvaluation,
  EvalWarning,
  KeywordScore,
  ParseabilityScore,
  RecruiterReport,
} from "./types";
import { fuzzyLocateNodes } from "./locate";

// ————————————————————————————————————————————————
// Composite scoring — weighted blend of the three layers.
//
// Weights:
//   • Parseability 40% — a visually-beautiful CV that parsers can't read is
//     useless for 70%+ of the pipeline. The single highest-leverage failure
//     mode, and the one most easily missed without tooling.
//   • Keywords     35% — strong correlation with first-pass filters, but not
//     the whole story (keyword-stuffed CVs still get thrown out by humans).
//   • Recruiter    25% — subjective, LLM-driven. Valuable signal but noisy —
//     kept as a meaningful but non-dominant slice.
//
// These add to 100. Changing the weights changes how much each layer tugs on
// the overall score, but not the per-layer diagnostics.
// ————————————————————————————————————————————————

const WEIGHT_PARSE = 0.4;
const WEIGHT_KEYWORDS = 0.35;
const WEIGHT_RECRUITER = 0.25;

type ScoreInput = {
  doc: CvDocument;
  job: ParsedJob | null;
  parseability: ParseabilityScore;
  keywords: KeywordScore;
  recruiter: RecruiterReport;
};

export function composeEvaluation(input: ScoreInput): CvEvaluation {
  const warnings = assembleWarnings(input);

  const recruiterScore = recruiterToScore(input.recruiter);

  const overall = Math.round(
    WEIGHT_PARSE * input.parseability.score +
      WEIGHT_KEYWORDS * input.keywords.score +
      WEIGHT_RECRUITER * recruiterScore,
  );

  return {
    overall: clamp(overall, 0, 100),
    parseability: input.parseability,
    keywords: input.keywords,
    recruiter: input.recruiter,
    warnings,
    runId: nanoid(10),
    evaluatedAt: Date.now(),
  };
}

// Map the recruiter's subjective judgement to a numeric score. Unavailable →
// neutral 60 (we don't reward or punish when the LLM isn't reachable).
function recruiterToScore(r: RecruiterReport): number {
  if (r.unavailable) return 60;
  let base = 50;
  if (r.interviewOdds === "Low") base = 35;
  if (r.interviewOdds === "Mid") base = 65;
  if (r.interviewOdds === "High") base = 85;

  // Each flagged issue drops 3 points, capped at -15.
  const issuePenalty = Math.min(r.flaggedIssues.length * 3, 15);
  return clamp(base - issuePenalty, 0, 100);
}

// Score parseability from an Affinda result. Missing fields dock points.
// Called by the evaluator entrypoint before this module composes the final
// score.
export function scoreParseability(
  doc: CvDocument,
  result: AffindaResult,
): ParseabilityScore {
  const warnings: string[] = [];

  if (result.unavailable) {
    warnings.push(
      result.unavailableReason ??
        "Parser unavailable — parseability layer was skipped.",
    );
    // Neutral 60 when parser can't run — doesn't pretend the CV parses
    // perfectly, but doesn't tank a score the user can't act on.
    return {
      score: 60,
      warnings,
      extracted: null,
      rawDocumentId: null,
    };
  }

  // Field-by-field scoring. Weight the essentials heavier than nice-to-haves.
  const weights: Record<string, number> = {
    name: 12,
    email: 12,
    phone: 8,
    location: 6,
    summary: 8,
    workExperience: 25,
    education: 10,
    skills: 10,
  };
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0); // 91

  let obtained = 0;
  for (const [field, weight] of Object.entries(weights)) {
    if (!result.missing.includes(field)) {
      obtained += weight;
    } else {
      warnings.push(`Parser could not extract ${field}.`);
    }
  }

  // Bonus: experience entries beyond the first (up to +9).
  const extraExp = Math.max(
    0,
    Math.min(3, result.extracted.workExperience.length - 1),
  );
  obtained += extraExp * 3;

  const raw = Math.round((obtained / (totalWeight + 9)) * 100);

  // Suspicion check: if raw text has lots of content but extraction is mostly
  // empty, the CV is probably image-heavy or uses non-selectable fonts.
  const textNodes = doc.pages
    .flatMap((p) => p.nodes)
    .filter((n) => n.type === "text" && !n.hidden).length;
  if (textNodes > 10 && result.extracted.workExperience.length === 0) {
    warnings.push(
      "Document has many text blocks but parser extracted zero work history — likely an image-based or structurally-broken layout.",
    );
  }

  return {
    score: clamp(raw, 0, 100),
    warnings,
    extracted: result.extracted,
    rawDocumentId: result.rawDocumentId,
  };
}

// Flatten all three layers' warnings into one list with consistent shape +
// targetNodeIds where we can compute them.
function assembleWarnings(input: ScoreInput): EvalWarning[] {
  const out: EvalWarning[] = [];

  for (const w of input.parseability.warnings) {
    out.push({
      layer: "parse",
      kind: classifyParseWarning(w),
      message: w,
      severity: w.toLowerCase().includes("zero") ? "error" : "warn",
    });
  }

  for (const w of input.keywords.warnings) {
    out.push({
      layer: "keywords",
      kind: "keyword-issue",
      message: w,
      severity: "warn",
    });
  }

  if (input.keywords.missed.length > 0) {
    const targets = fuzzyLocateNodes(
      input.doc,
      input.keywords.missed.slice(0, 6),
    );
    for (const m of input.keywords.missed.slice(0, 6)) {
      out.push({
        layer: "keywords",
        kind: "missing-keyword",
        message: `Missing keyword: "${m}"`,
        targetNodeIds: targets.get(m) ?? [],
        severity: "info",
      });
    }
  }

  if (!input.recruiter.unavailable) {
    out.push({
      layer: "recruiter",
      kind: "weakness",
      message: `Biggest weakness: ${input.recruiter.biggestWeakness}`,
      severity: "warn",
    });
    out.push({
      layer: "recruiter",
      kind: "improvement",
      message: `Suggested fix: ${input.recruiter.concreteImprovement}`,
      severity: "info",
    });
    for (const issue of input.recruiter.flaggedIssues) {
      out.push({
        layer: "recruiter",
        kind: issue.kind,
        message: issue.message,
        severity: issue.kind === "over-claiming" ? "error" : "warn",
      });
    }
  } else if (input.recruiter.unavailableReason) {
    out.push({
      layer: "recruiter",
      kind: "unavailable",
      message: input.recruiter.unavailableReason,
      severity: "info",
    });
  }

  return out;
}

function classifyParseWarning(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("could not extract")) return "missing-field";
  if (m.includes("unavailable") || m.includes("skipped")) return "parser-skipped";
  if (m.includes("image-based") || m.includes("zero")) return "parse-structure";
  return "parse-issue";
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
