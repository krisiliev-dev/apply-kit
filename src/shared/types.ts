// Shared types between content script, background worker, and popup.
// Kept deliberately small so the message contract is obvious.

export type FieldKind =
  | "text"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "file";

export interface FieldContext {
  /** Stable-ish id for the field within the page (element id, name, or synthesized). */
  id: string;
  /** Human-readable label derived from <label>, aria-label, placeholder, nearby heading. */
  label: string;
  /** Placeholder text if present. */
  placeholder: string;
  kind: FieldKind;
  /** Normalized question text used for lookup. */
  questionNormalized: string;
}

export interface HistoricalAnswer {
  value: string;
  at: number;
  url: string;
}

export interface AnswerRecord {
  id: string;
  questionNormalized: string;
  questionLabel: string;
  fieldKind: FieldKind;
  answers: HistoricalAnswer[];
  tags?: string[];
}

export interface MatchResult {
  record: AnswerRecord;
  /** 0..1, higher is better. */
  confidence: number;
  /** Best answer to suggest (most recent of top record). */
  suggestion: string;
}

// Discovery queue: job postings the user actively viewed on LinkedIn / Indeed / Glassdoor
// and explicitly saved via the capture pill. No scraping; only DOM the user has open.
export type JobSource = "linkedin" | "indeed" | "glassdoor";

export interface CapturedJob {
  id: string;
  source: JobSource;
  url: string;
  title: string;
  company: string;
  location?: string;
  salary?: string;
  description?: string;
  postedAt?: string;
  capturedAt: number;
  syncedToWebApp?: boolean;
}

export interface JobSyncResult {
  total: number;
  synced: number;
  failed: number;
  /** Set if the whole sync attempt was aborted (bad URL, endpoint unreachable). */
  error?: string;
}

// Message contract between content <-> background.
// Using a discriminated union keeps `any` out of the channel.

export interface PairedDeviceSummary {
  webAppUrl: string;
  deviceId: string;
  deviceLabel: string;
  pairedAt: number;
  lastSyncAt: number;
}

export type BgRequest =
  | { kind: "queryByQuestion"; field: FieldContext }
  | {
      kind: "saveAnswer";
      field: FieldContext;
      value: string;
      url: string;
    }
  | { kind: "listAnswers"; query?: string }
  | { kind: "deleteAnswer"; id: string }
  | { kind: "updateAnswer"; id: string; value: string }
  | { kind: "exportAll" }
  | { kind: "importAll"; records: AnswerRecord[]; mode: "merge" | "replace" }
  | { kind: "embedQuestion"; text: string }
  | {
      kind: "captureJob";
      job: Omit<CapturedJob, "id" | "capturedAt" | "syncedToWebApp">;
    }
  | { kind: "listJobs" }
  | { kind: "deleteJob"; id: string }
  | { kind: "syncDiscoveryQueue" }
  | { kind: "syncJob"; id: string }
  | { kind: "getConfig" }
  | { kind: "setConfig"; cvMakerBaseUrl: string }
  | { kind: "getPairing" }
  | {
      kind: "completePairing";
      webAppUrl: string;
      code: string;
      deviceLabel: string;
    }
  | { kind: "unpair" }
  | {
      kind: "paraphrase";
      text: string;
      context: { jobTitle?: string; companyName?: string; fieldLabel: string };
    };

export type BgResponse =
  | { kind: "queryByQuestion"; match: MatchResult | null }
  | { kind: "saveAnswer"; record: AnswerRecord }
  | { kind: "listAnswers"; records: AnswerRecord[] }
  | { kind: "deleteAnswer"; ok: true }
  | { kind: "updateAnswer"; record: AnswerRecord }
  | { kind: "exportAll"; records: AnswerRecord[] }
  | { kind: "importAll"; imported: number }
  | { kind: "embedQuestion"; vector: number[] | null }
  | { kind: "captureJob"; job: CapturedJob; synced: boolean }
  | { kind: "listJobs"; jobs: CapturedJob[] }
  | { kind: "deleteJob"; ok: true }
  | { kind: "syncDiscoveryQueue"; result: JobSyncResult }
  | { kind: "syncJob"; job: CapturedJob; synced: boolean }
  | { kind: "getConfig"; cvMakerBaseUrl: string }
  | { kind: "setConfig"; cvMakerBaseUrl: string }
  | { kind: "getPairing"; pairing: PairedDeviceSummary | null }
  | {
      kind: "completePairing";
      pairing: PairedDeviceSummary;
    }
  | { kind: "unpair"; ok: true }
  | { kind: "paraphrase"; text: string; changed: boolean }
  | { kind: "error"; message: string };
