// Shared types for the CV evaluation pipeline.
//
// The evaluator runs three independent layers against a CvDocument:
//   1. Parseability — render to PDF, feed to Affinda, see what an ATS extracts.
//   2. Keyword alignment — text coverage against the parsed job's keyword list.
//   3. Recruiter-eye — subjective LLM pass as a senior recruiter.
//
// Composite score and unified warnings are assembled in `score.ts`.

export type AffindaExtracted = {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  summary?: string;
  workExperience: AffindaWorkEntry[];
  education: AffindaEducationEntry[];
  skills: string[];
  languages?: string[];
};

export type AffindaWorkEntry = {
  title?: string;
  company?: string;
  start?: string;
  end?: string;
  bullets?: string[];
};

export type AffindaEducationEntry = {
  school?: string;
  degree?: string;
  start?: string;
  end?: string;
};

export type AffindaResult = {
  extracted: AffindaExtracted;
  /** Field names Affinda couldn't extract (e.g. ["email", "phone"]). */
  missing: string[];
  /** Affinda Document identifier for reference/debugging. */
  rawDocumentId: string;
  /** True when Affinda wasn't reachable (missing key, failure, etc.). */
  unavailable?: boolean;
  /** Reason string when unavailable. */
  unavailableReason?: string;
};

export type RecruiterInterviewOdds = "Low" | "Mid" | "High";

export type RecruiterFlaggedIssue = {
  kind:
    | "unclear-header"
    | "inconsistent-tense"
    | "buzzword-no-evidence"
    | "over-claiming"
    | "format-issue"
    | "other";
  message: string;
};

export type RecruiterReport = {
  strongestSignal: string;
  biggestWeakness: string;
  concreteImprovement: string;
  flaggedIssues: RecruiterFlaggedIssue[];
  interviewOdds: RecruiterInterviewOdds;
  unavailable?: boolean;
  unavailableReason?: string;
};

export type EvalLayer = "parse" | "keywords" | "recruiter";
export type EvalSeverity = "info" | "warn" | "error";

export type EvalWarning = {
  layer: EvalLayer;
  kind: string;
  message: string;
  targetNodeIds?: string[];
  severity: EvalSeverity;
};

export type ParseabilityScore = {
  score: number; // 0-100
  warnings: string[];
  extracted: AffindaExtracted | null;
  /** Null when parser was skipped (missing key / failure). */
  rawDocumentId: string | null;
};

export type KeywordScore = {
  score: number; // 0-100
  coverage: number; // 0-1
  missed: string[];
  matched: string[];
  warnings: string[];
};

export type CvEvaluation = {
  overall: number; // 0-100
  parseability: ParseabilityScore;
  keywords: KeywordScore;
  recruiter: RecruiterReport;
  warnings: EvalWarning[];
  runId: string;
  evaluatedAt: number;
};
