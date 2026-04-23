// Domain types for the /discover feature.
// Everything here is JSON-serializable so state can live in localStorage.

export type JobPostingSource =
  | { kind: "greenhouse"; company: string }
  | { kind: "lever"; company: string }
  | { kind: "ashby"; company: string }
  | { kind: "hn-hiring"; threadId: string }
  | { kind: "rss"; feedUrl: string }
  | { kind: "linkedin" }
  | { kind: "indeed" }
  | { kind: "glassdoor" };

export type JobPostingSourceKind = JobPostingSource["kind"];

export const JOB_SOURCE_KINDS: JobPostingSourceKind[] = [
  "greenhouse",
  "lever",
  "ashby",
  "hn-hiring",
  "rss",
  "linkedin",
  "indeed",
  "glassdoor",
];

export type JobPosting = {
  id: string; // stable hash of (source.kind + url + postedAt)
  source: JobPostingSource;
  url: string;
  title: string;
  company: string;
  location?: string;
  salary?: string;
  description?: string;
  postedAt?: number;
  fetchedAt: number;
};

export type ScoredPosting = JobPosting & {
  score: number;
  why: string[];
  hardReject?: boolean;
};

export type DiscoveryPreferences = {
  watchlist: {
    greenhouse: string[];
    lever: string[];
    ashby: string[];
  };
  rssFeeds: string[];
  trackHnHiring: boolean;
  workAuth: string[]; // e.g. ["US", "EU"]
  remoteOnly?: boolean;
  preferredLocations: string[];
  salaryFloor?: number; // annual USD-equivalent
  titleDenylist: string[];
};

export type DiscoveryState = {
  postings: Record<string, ScoredPosting>;
  dismissed: Record<string, number>; // id → dismissedAt
  saved: Record<string, number>; // id → savedAt
  lastFetchAt: Record<string, number>; // source key → timestamp
};

// Payload accepted by /api/discover/ingest from the browser extension.
export type IngestPayload = {
  source: "linkedin" | "indeed" | "glassdoor";
  url: string;
  title: string;
  company: string;
  location?: string;
  salary?: string;
  description?: string;
  capturedAt: number;
};

export const DISCOVERY_PREFS_KEY = "cv-maker:discovery-prefs";
export const DISCOVERY_STATE_KEY = "cv-maker:discovery-state";

export const DEFAULT_DISCOVERY_PREFERENCES: DiscoveryPreferences = {
  watchlist: { greenhouse: [], lever: [], ashby: [] },
  rssFeeds: [],
  trackHnHiring: false,
  workAuth: [],
  remoteOnly: false,
  preferredLocations: [],
  titleDenylist: [],
};

export const EMPTY_DISCOVERY_STATE: DiscoveryState = {
  postings: {},
  dismissed: {},
  saved: {},
  lastFetchAt: {},
};
