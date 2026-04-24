// Shared types for the CV evaluation pipeline.
//
// The evaluator runs five independent layers against a CvDocument:
//   1. Parseability  — render to PDF, feed to Affinda, see what an ATS extracts.
//   2. Keyword       — text coverage against the parsed job's keyword list.
//   3. Recruiter-eye — subjective LLM pass as a senior recruiter.
//   4. Six-second    — simulates a recruiter's first-glance skim of the PDF.
//   5. Numbers       — static check that outcome-claiming bullets have scope.
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

// ————————————————————————————————————————————————
// Six-second test — simulates a recruiter skimming the rendered PDF. We want
// to know what sticks in 6s, what got misread, and whether the candidate's
// name and current role survive a glance. Catches the scannability failure
// that kills most CVs even when every other layer passes.
// ————————————————————————————————————————————————

export type SixSecondSeniority =
  | "junior"
  | "mid"
  | "senior"
  | "staff"
  | "unclear";

export type SixSecondReport = {
  nameRead?: string;
  currentRoleRead?: string;
  seniorityImpression?: SixSecondSeniority;
  strongestSignal: string;
  oneThingRemembered: string;
  /** Things the simulated recruiter got wrong (wrong name, wrong company, misread). */
  misreadings: string[];
  scannabilityScore: number; // 0-100
  warnings: string[];
  unavailable?: boolean;
  unavailableReason?: string;
};

// ————————————————————————————————————————————————
// "Where's the number?" inspector — flags bullets that claim an outcome
// without scope, metric, or baseline. Purely static — runs every keystroke.
// ————————————————————————————————————————————————

export type NumberInspectorFlag = {
  nodeId: string;
  text: string;
  reason: string;
};

export type NumberInspectorReport = {
  totalBullets: number;
  bulletsWithMetrics: number;
  flaggedBullets: NumberInspectorFlag[];
  /** bulletsWithMetrics / totalBullets * 100, rounded. 100 if no bullets. */
  score: number;
};

export type EvalLayer =
  | "parse"
  | "keywords"
  | "recruiter"
  | "six-second"
  | "numbers";
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
  /** Optional six-second recruiter-skim pass. Requires Affinda + PDF render. */
  sixSecond?: SixSecondReport;
  /** Always-on static number-in-bullet inspector. */
  numbers?: NumberInspectorReport;
  warnings: EvalWarning[];
  runId: string;
  evaluatedAt: number;
};
