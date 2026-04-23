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

// Message contract between content <-> background.
// Using a discriminated union keeps `any` out of the channel.

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
  | { kind: "embedQuestion"; text: string };

export type BgResponse =
  | { kind: "queryByQuestion"; match: MatchResult | null }
  | { kind: "saveAnswer"; record: AnswerRecord }
  | { kind: "listAnswers"; records: AnswerRecord[] }
  | { kind: "deleteAnswer"; ok: true }
  | { kind: "updateAnswer"; record: AnswerRecord }
  | { kind: "exportAll"; records: AnswerRecord[] }
  | { kind: "importAll"; imported: number }
  | { kind: "embedQuestion"; vector: number[] | null }
  | { kind: "error"; message: string };
