// Domain model for the career-advisor lens.
//
// Everything here is JSON-serializable so state can live in localStorage.
// Each artifact carries its own `generatedAt` so the index page can show
// freshness without needing a global clock.

// ———————————————————————————————————————————————
// Narrative
// ———————————————————————————————————————————————

export type NarrativeFraming = {
  id: string;
  title: string; // "The operator", "The polymath", "The specialist"
  summary: string; // 2-3 sentence framing
  evidenceFromHistory: string[]; // specific experiences/projects that fit
  risks: string[]; // what this framing undersells
};

export type CareerNarrative = {
  currentStoryDetected: string; // what the CV is currently (unintentionally) saying
  generatedAt: number;
  framings: NarrativeFraming[]; // 2-3 alternatives
};

// ———————————————————————————————————————————————
// Skills
// ———————————————————————————————————————————————

export type SkillDemand = {
  skill: string;
  demandCount: number; // how many of the analyzed postings require it
  sampleCompanies: string[]; // 3-5 examples
  userHasIt: boolean;
  adjacencyNote?: string; // "you have X, which is close"
};

export type AcquisitionPath = {
  skill: string;
  path: string;
  effortWeeks: number;
};

export type SkillGapAnalysis = {
  analyzedPostingCount: number;
  window: { from: number; to: number };
  userHas: string[];
  criticalGaps: SkillDemand[]; // demandCount high + userHasIt false
  niceToHaveGaps: SkillDemand[];
  acquisitionPaths: AcquisitionPath[];
  generatedAt: number;
};

// ———————————————————————————————————————————————
// Strategic ceiling / floor
// ———————————————————————————————————————————————

export type RoleTier = "below" | "in-range" | "stretch" | "aspirational";

export const ROLE_TIERS: RoleTier[] = [
  "below",
  "in-range",
  "stretch",
  "aspirational",
];

export type RoleClassification = {
  title: string;
  company?: string;
  tier: RoleTier;
  reasoning: string;
  sourceUrl?: string;
};

export type StrategicProfile = {
  inRangeSignals: string[];
  readyForStretch: boolean;
  stretchGapsToClose: string[];
  classifications: RoleClassification[]; // from recent /discover or applications
  generatedAt: number;
};

// ———————————————————————————————————————————————
// Decision support
// ———————————————————————————————————————————————

export type DecisionKind = "offer-evaluation" | "stay-vs-go" | "pivot";

export const DECISION_KINDS: DecisionKind[] = [
  "offer-evaluation",
  "stay-vs-go",
  "pivot",
];

export const DECISION_LABEL: Record<DecisionKind, string> = {
  "offer-evaluation": "Offer evaluation",
  "stay-vs-go": "Stay vs. go",
  pivot: "Pivot consideration",
};

export type DecisionConfidence = "low" | "mid" | "high";

export type DecisionAnalysis = {
  id: string;
  kind: DecisionKind;
  inputSummary: string;
  pros: string[];
  cons: string[];
  questions: string[]; // things to probe before deciding
  recommendation: string; // the honest one-liner
  confidence: DecisionConfidence;
  generatedAt: number;
};

// Structured inputs per decision kind. Free-form `context` is always allowed.

export type OfferEvaluationInput = {
  kind: "offer-evaluation";
  company: string;
  role: string;
  baseSalary?: string;
  equity?: string;
  totalComp?: string;
  location?: string;
  reportingTo?: string;
  context?: string;
};

export type StayVsGoInput = {
  kind: "stay-vs-go";
  currentRole: string;
  currentCompany: string;
  tenureMonths?: number;
  alternativeRole?: string;
  alternativeCompany?: string;
  compDelta?: string;
  context?: string;
};

export type PivotInput = {
  kind: "pivot";
  fromDomain: string;
  toDomain: string;
  horizonMonths?: number;
  context?: string;
};

export type DecisionInput = OfferEvaluationInput | StayVsGoInput | PivotInput;

// ———————————————————————————————————————————————
// Pacing
// ———————————————————————————————————————————————

export type PacingSnapshot = {
  last7Days: number;
  last30Days: number;
  sustainablePerWeek: number; // derived from user's configured effort target / 4
  sprintDetected: boolean;
  daysSinceLastGap: number; // days since a gap of >=2 days in applications
  guidance: string;
  generatedAt: number;
};

// ———————————————————————————————————————————————
// Persistence keys
// ———————————————————————————————————————————————

export const ADVISOR_KEYS = {
  narrative: "cv-maker:advisor:narrative",
  skills: "cv-maker:advisor:skills",
  ceiling: "cv-maker:advisor:ceiling",
  decisions: "cv-maker:advisor:decisions",
  pacing: "cv-maker:advisor:pacing",
} as const;

export const DECISIONS_HISTORY_MAX = 20;

// ———————————————————————————————————————————————
// Aggregated advisor state (index page consumes this)
// ———————————————————————————————————————————————

export type AdvisorState = {
  narrative: CareerNarrative | null;
  skills: SkillGapAnalysis | null;
  ceiling: StrategicProfile | null;
  decisions: DecisionAnalysis[]; // newest first, capped at DECISIONS_HISTORY_MAX
  pacing: PacingSnapshot | null;
};

export const EMPTY_ADVISOR_STATE: AdvisorState = {
  narrative: null,
  skills: null,
  ceiling: null,
  decisions: [],
  pacing: null,
};
