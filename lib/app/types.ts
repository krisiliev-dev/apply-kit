// Domain model for the applications tracker.
// Kept deliberately simple and JSON-serializable so the entire state can live in
// localStorage. `events` is future-proofing — today only `updateStatus` writes to it.

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
};
