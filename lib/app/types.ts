// Domain model for the applications tracker.
// Kept deliberately simple and JSON-serializable so the entire state can live in
// localStorage. `events` is future-proofing — today only `updateStatus` writes to it.
//
// Ownership: the /applications tracker owns the canonical shape. The /jobs
// "apply" flow writes Application records; /applications reads them.

export type ApplicationStatus =
  | "draft"
  | "applied"
  | "screen"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn"
  | "ghosted-short"
  | "ghosted-long";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "draft",
  "applied",
  "screen",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "ghosted-short",
  "ghosted-long",
];

// Statuses that are terminal/unfavourable — the UI surfaces the rejection
// learning section for any of these.
export const CLOSED_UNFAVOURABLE_STATUSES: ApplicationStatus[] = [
  "rejected",
  "withdrawn",
  "ghosted-short",
  "ghosted-long",
];

export type ParsedJob = {
  title: string;
  company: string;
  location?: string;
  salary?: string;
  description?: string;
  requirements: string[];
  responsibilities: string[];
  niceToHave?: string[];
  keywords: string[];
  sourceUrl?: string;
};

export type ApplicationEvent = {
  at: number;
  kind: "status-change" | "note" | "reminder" | string;
  note?: string;
  from?: ApplicationStatus;
  to?: ApplicationStatus;
};

export type CoverLetterTone = "neutral" | "warm" | "direct" | "witty";

export type CoverLetter = {
  body: string; // plain text or simple markdown
  tone?: CoverLetterTone;
  generatedAt: number;
};

// ———————————————————————————————————————————————
// Rejection learning
// ———————————————————————————————————————————————

export type RejectionReasonKind =
  | "auto-rejection" // pipeline told you no
  | "post-screen" // made it past screen then lost
  | "post-interview" // lost after at least one interview
  | "post-final" // last round loss
  | "ghosted-short" // ≤2 weeks, no response
  | "ghosted-long" // >2 weeks, no response
  | "self-withdrawn"
  | "offer-declined-by-me";

export const REJECTION_REASON_KINDS: RejectionReasonKind[] = [
  "auto-rejection",
  "post-screen",
  "post-interview",
  "post-final",
  "ghosted-short",
  "ghosted-long",
  "self-withdrawn",
  "offer-declined-by-me",
];

export const REJECTION_REASON_LABEL: Record<RejectionReasonKind, string> = {
  "auto-rejection": "Auto-rejection",
  "post-screen": "Post-screen loss",
  "post-interview": "Post-interview loss",
  "post-final": "Final-round loss",
  "ghosted-short": "Ghosted ≤2 weeks",
  "ghosted-long": "Ghosted >2 weeks",
  "self-withdrawn": "Self-withdrawn",
  "offer-declined-by-me": "Declined offer",
};

export type RejectionPoliteness = "curt" | "standard" | "warm" | "template";
export type RejectionSeniorityFeedback = "under" | "over" | "fit";
export type RejectionStageLost =
  | "resume"
  | "screen"
  | "interview"
  | "final"
  | "offer";

export type RejectionExtractedSignals = {
  citedReasons: string[]; // exact phrases if visible
  inferredReasons: string[]; // AI inferences
  politeness: RejectionPoliteness;
  seniorityFeedback?: RejectionSeniorityFeedback;
  salaryMismatch?: boolean;
  compensationHint?: string;
  stageLost: RejectionStageLost;
};

export type RejectionSignal = {
  kind: RejectionReasonKind;
  rawInputText?: string; // pasted email / note
  closedAt: number; // when the outcome was recorded
  extractedSignals: RejectionExtractedSignals;
  aiSummary: string; // one sentence
  lessonsForFuture: string[]; // 1-3 concrete, non-generic
};

// ———————————————————————————————————————————————
// Interview prep
// ———————————————————————————————————————————————

export type InterviewQuestionKind =
  | "behavioral"
  | "technical"
  | "system-design"
  | "values"
  | "situational"
  | "culture-fit"
  | "other";

export type InterviewConfidence = "low" | "mid" | "high";

export type InterviewStarAnswer = {
  situation: string;
  task: string;
  action: string;
  result: string;
  sourcedFrom?: string; // e.g. "experience: Senior Eng at Kettle Labs"
};

export type InterviewQuestion = {
  id: string;
  question: string;
  kind: InterviewQuestionKind;
  rationale: string;
  starAnswer?: InterviewStarAnswer;
  userDraft?: string;
  confidence?: InterviewConfidence;
  lastPracticedAt?: number;
};

export type CompanyPublicSignal = {
  source: string;
  note: string;
};

export type CompanyResearch = {
  summary: string;
  publicSignals: CompanyPublicSignal[];
  likelyInterviewStyle?: string;
};

export type InterviewPrep = {
  generatedAt: number;
  questions: InterviewQuestion[];
  companyResearch?: CompanyResearch;
};

// ———————————————————————————————————————————————
// Pre-screen answers
// ———————————————————————————————————————————————

export type PreScreenTone = "direct" | "warm" | "witty" | "neutral";

export type PreScreenQuestion = {
  id: string;
  prompt: string;
  wordLimit?: number;
  draft?: string;
  finalAnswer?: string;
  generatedAt?: number;
  tone?: PreScreenTone;
};

export type PreScreen = {
  questions: PreScreenQuestion[];
  generatedAt: number;
};

export type Application = {
  id: string;
  company: string;
  role: string;
  url?: string;
  jobDescriptionRaw?: string;
  jobData?: ParsedJob;
  cvSlug?: string;
  dateCreated: number;
  status: ApplicationStatus;
  notes?: string;
  events?: ApplicationEvent[];
  coverLetter?: CoverLetter;
  rejection?: RejectionSignal;
  interviewPrep?: InterviewPrep;
  preScreen?: PreScreen;
};

// Persistence key used by both the reader (lib/app/persist.ts) and the
// writer-side helpers (lib/app/storage.ts, shipped by the /jobs flow).
export const APPLICATIONS_STORAGE_KEY = "cv-maker:applications";
