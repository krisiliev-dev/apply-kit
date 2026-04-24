import { nanoid } from "nanoid";
import type { CvDocument } from "@/lib/doc/types";
import type { ParsedJob } from "@/lib/app/types";
import type {
  AffindaResult,
  ArchetypeReport,
  CvEvaluation,
  EvalWarning,
  KeywordScore,
  NumberInspectorReport,
  ParseabilityScore,
  ProofInspectorReport,
  RecruiterReport,
  SixSecondReport,
  TenureReport,
} from "./types";
import { fuzzyLocateNodes } from "./locate";
import {
  ARCHETYPE_BY_CATEGORY_LABEL,
} from "./archetypes";
import { countMatchesPerNode } from "./archetypeDetector";

// ————————————————————————————————————————————————
// Composite scoring — weighted blend of every layer.
//
// The recruiter lens rolled out three more fast synchronous layers (proof,
// archetype, tenure). Rationale for the current weight slicing:
//
// When all five "heavy" layers run (parseability + keywords + recruiter +
// six-second + the fast layers):
//   • Parseability    30%   — machine-readability is still the floor
//   • Keywords        25%   — job match is the biggest qualifier
//   • Recruiter       15%   — subjective but signal-rich
//   • Six-second      15%   — scannability (slightly lower than before)
//   • Numbers          7.5% — concrete outcomes
//   • Proof            7.5% — verifiable artifacts
//   • Archetype       ~0%   — reported but doesn't move the composite much,
//                             since it mostly overlaps recruiter-eye
//   • Tenure          ~0%   — signals a narrative problem, not a score one
//
// Wait — archetype and tenure at zero? We include them in warnings (which
// is where they matter most) and keep them scoreable from the UI, but their
// heuristics are softer than the rest. Dropping them out of composite
// keeps overall score tied to verifiable facts. Both still surface in the
// EvalPanel and both move the "overall flag count" a user reads first.
//
// When six-second is unavailable (no AFFINDA_API_KEY), we redistribute
// proportionally:
//   • Parseability    35%
//   • Keywords        30%
//   • Recruiter       20%
//   • Numbers          7.5%
//   • Proof            7.5%
//
// All slices add to 100 in their respective modes. Keywords coverage alone
// isn't enough to lift a CV; proof/numbers stack on top.
// ————————————————————————————————————————————————

// With-six-second weights
const W_PARSE_SIX = 0.3;
const W_KEYWORDS_SIX = 0.25;
const W_RECRUITER_SIX = 0.15;
const W_SIX_SECOND = 0.15;
const W_NUMBERS_SIX = 0.075;
const W_PROOF_SIX = 0.075;

// No-six-second (base) weights — preserve parseability dominance, keep
// numbers+proof at the same 7.5 each for behavioural consistency.
const W_PARSE_BASE = 0.35;
const W_KEYWORDS_BASE = 0.3;
const W_RECRUITER_BASE = 0.2;
const W_NUMBERS_BASE = 0.075;
const W_PROOF_BASE = 0.075;

type ScoreInput = {
  doc: CvDocument;
  job: ParsedJob | null;
  parseability: ParseabilityScore;
  keywords: KeywordScore;
  recruiter: RecruiterReport;
  sixSecond?: SixSecondReport;
  numbers?: NumberInspectorReport;
  proof?: ProofInspectorReport;
  archetype?: ArchetypeReport;
  tenure?: TenureReport;
};

export function composeEvaluation(input: ScoreInput): CvEvaluation {
  const warnings = assembleWarnings(input);

  const recruiterScore = recruiterToScore(input.recruiter);
  const numbersScore = input.numbers?.score ?? 100;
  const proofScore = input.proof?.score ?? 100;

  const hasSix = input.sixSecond && !input.sixSecond.unavailable;

  let overall: number;
  if (hasSix && input.sixSecond) {
    overall = Math.round(
      W_PARSE_SIX * input.parseability.score +
        W_KEYWORDS_SIX * input.keywords.score +
        W_RECRUITER_SIX * recruiterScore +
        W_SIX_SECOND * input.sixSecond.scannabilityScore +
        W_NUMBERS_SIX * numbersScore +
        W_PROOF_SIX * proofScore,
    );
  } else {
    overall = Math.round(
      W_PARSE_BASE * input.parseability.score +
        W_KEYWORDS_BASE * input.keywords.score +
        W_RECRUITER_BASE * recruiterScore +
        W_NUMBERS_BASE * numbersScore +
        W_PROOF_BASE * proofScore,
    );
  }

  return {
    overall: clamp(overall, 0, 100),
    parseability: input.parseability,
    keywords: input.keywords,
    recruiter: input.recruiter,
    sixSecond: input.sixSecond,
    numbers: input.numbers,
    proof: input.proof,
    archetype: input.archetype,
    tenure: input.tenure,
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

// Flatten all layers' warnings into one list with consistent shape +
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

  // Six-second layer
  if (input.sixSecond) {
    if (input.sixSecond.unavailable) {
      if (input.sixSecond.unavailableReason) {
        out.push({
          layer: "six-second",
          kind: "unavailable",
          message: input.sixSecond.unavailableReason,
          severity: "info",
        });
      }
    } else {
      for (const mis of input.sixSecond.misreadings) {
        out.push({
          layer: "six-second",
          kind: "misreading",
          message: `Skim misread: ${mis}`,
          severity: "warn",
        });
      }
      for (const w of input.sixSecond.warnings) {
        out.push({
          layer: "six-second",
          kind: "scannability",
          message: w,
          severity:
            /didn't identify your name/i.test(w) ||
            /not readable at a glance/i.test(w)
              ? "error"
              : "warn",
        });
      }
    }
  }

  // Number-inspector — always on
  if (input.numbers) {
    for (const f of input.numbers.flaggedBullets) {
      out.push({
        layer: "numbers",
        kind: "missing-metric",
        message: `No number/scope: "${f.text}"`,
        targetNodeIds: [f.nodeId],
        severity: "warn",
      });
    }
  }

  // Proof-of-work — always on
  if (input.proof) {
    for (const m of input.proof.missing) {
      out.push({
        layer: "proof",
        kind: "missing-proof",
        message: `Missing proof-of-work link: "${m.text}"`,
        targetNodeIds: [m.nodeId],
        severity: "warn",
      });
    }
  }

  // Archetype — always on. Severity "info" unless a single node collects
  // >3 matches, in which case escalate that node's matches to "warn".
  if (input.archetype) {
    const perNode = countMatchesPerNode(input.archetype.matches);
    for (const m of input.archetype.matches) {
      const count = perNode.get(m.nodeId) ?? 0;
      const sev: "info" | "warn" = count > 3 ? "warn" : "info";
      const label = ARCHETYPE_BY_CATEGORY_LABEL[m.category];
      out.push({
        layer: "archetype",
        kind: m.category,
        message: `${label}: "${m.phrase}". Try: ${m.suggestion}`,
        targetNodeIds: [m.nodeId],
        severity: sev,
      });
    }
  }

  // Tenure — always on
  if (input.tenure) {
    for (const w of input.tenure.warnings) {
      out.push({
        layer: "tenure",
        kind: w.kind,
        message: w.message,
        severity:
          w.kind === "consecutive-short-tenure"
            ? "warn"
            : w.kind === "overall-short-tenure"
              ? "warn"
              : "info",
      });
    }
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
