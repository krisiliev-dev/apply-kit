// Shared types for the "apply" workflow + the application tracker.
// Agent B owns the /applications UI. If they change this file in breaking ways,
// prefer their Application shape — we only WRITE records; they READ them.

export type ApplicationStatus =
  | "draft"
  | "applied"
  | "screen"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn";

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
  kind: string;
  note?: string;
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

// Persistence key used by both this feature (writer) and /applications (reader).
export const APPLICATIONS_STORAGE_KEY = "cv-maker:applications";
