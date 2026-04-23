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
  | "withdrawn";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "draft",
  "applied",
  "screen",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
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
  interviewPrep?: InterviewPrep;
  preScreen?: PreScreen;
};

// Persistence key used by both the reader (lib/app/persist.ts) and the
// writer-side helpers (lib/app/storage.ts, shipped by the /jobs flow).
export const APPLICATIONS_STORAGE_KEY = "cv-maker:applications";
