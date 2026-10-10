// Domain types for the /discover feature.
// Everything here is JSON-serializable so state can live in localStorage.

export type JobPostingSource =
  | { kind: "greenhouse"; company: string }
  | { kind: "lever"; company: string }
  | { kind: "ashby"; company: string }
  | { kind: "hn-hiring"; threadId: string }
  | { kind: "rss"; feedUrl: string }
  | { kind: "careerpage"; url: string; site?: string }
  | { kind: "smartrecruiters"; company: string }
  | { kind: "workday"; company: string }
  | { kind: "jooble"; query: string }
  | { kind: "arbeitnow"; query?: string }
  | { kind: "jobapi"; provider: string; query?: string }
  | { kind: "linkedin" }
  | { kind: "indeed" }
  | { kind: "glassdoor" }
  | { kind: "jobsbg" }
  // Generic own-session capture from the browser extension (any job page).
  | { kind: "capture"; site?: string };

export type JobPostingSourceKind = JobPostingSource["kind"];

export const JOB_SOURCE_KINDS: JobPostingSourceKind[] = [
  "greenhouse",
  "lever",
  "ashby",
  "hn-hiring",
  "rss",
  "careerpage",
  "smartrecruiters",
  "workday",
  "jooble",
  "arbeitnow",
  "jobapi",
  "linkedin",
  "indeed",
  "glassdoor",
  "jobsbg",
  "capture",
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
  // Lower = more preferred location. 0 = first preferred location (e.g. Sofia),
  // then other preferred, then remote, then everywhere else. Primary sort key.
  locationRank?: number;
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
  source: "linkedin" | "indeed" | "glassdoor" | "jobsbg" | "capture";
  /** Optional site label for generic 'capture' source (e.g. host). */
  site?: string;
  url: string;
  title: string;
  company: string;
  location?: string;
  salary?: string;
  description?: string;
  capturedAt: number;
};

// A registered, crawlable source. The agent's research adds these (addedBy:
// "research"); the user can add them manually too. ATS + rss kinds feed the
// existing aggregator (their ref is folded into DiscoveryPreferences at crawl
// time); careerpage/board kinds are crawled by the puppeteer extractor.
export type DiscoverySourceKind =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "rss"
  | "careerpage"
  | "board"
  | "smartrecruiters"
  | "workday"
  | "jooble"
  | "arbeitnow"
  | "reed"
  | "remotive"
  | "jobicy"
  | "themuse"
  | "findwork"
  | "eures";

export type DiscoverySource = {
  id: string; // deterministic: `${kind}:${ref}` (lowercased)
  kind: DiscoverySourceKind;
  ref: string; // ATS slug, or full URL for rss/careerpage/board
  label: string;
  region?: string; // free-text hint, e.g. "Sofia" / "Manchester" / "Remote-EU"
  addedBy: "manual" | "research";
  enabled: boolean;
  lastCrawledAt?: number;
  note?: string;
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
