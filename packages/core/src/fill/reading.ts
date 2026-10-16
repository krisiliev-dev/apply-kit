// What Apply's filler reads from a portal page and what comes back for it (Apply spec #23, #38).
// Plain data shared by the fill engine and the extension: the extension reads the page into a
// `PageReading`, the engine answers each field, the extension fills and reports `FieldOutcome`s.
// Browser-safe: types and pure helpers only.
import type { AnswerKind } from "../preparation/answers.ts";
import type { PageJobReference } from "../preparation/contracts.ts";

export type PageKind = "form" | "account" | "sign-in" | "review" | "confirmation" | "posting" | "other";

export type FieldKind = "text" | "email" | "tel" | "url" | "textarea" | "number" | "date" | "select" | "typeahead" | "radio" | "checkbox" | "file";

/** One field on the page, in the portal's order. Its current value is read, but never stored. */
export interface ReadField {
  /** Stable within the page (the element's id or name). */
  id: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** The value in the field now ("" when empty). */
  value: string;
  /** A select's or radio group's options, as the portal words them. */
  options: string[];
  maxLength: number | null;
  /** A terms, consent or "I certify" box: never ticked. */
  consent: boolean;
  /** A password: never touched. */
  password: boolean;
  /** The field's autocomplete token ("given-name", "email"), when the portal gives one. */
  hint: string | null;
}

export interface PageReading {
  pageKind: PageKind;
  /** The portal job reference the page shows, if any. */
  jobRef: PageJobReference | null;
  /** The portal's own name for this step ("My Information"), or null. */
  stepLabel: string | null;
  /** Only when the portal prints it ("Page 2 of 5"). */
  stepCount: { current: number; total: number } | null;
  fields: ReadField[];
}

/** Where a filled value came from, as the panel names it. */
export type FillSource = "profile" | "answer-bank" | "package" | "cv-version" | "you";

/**
 * "Save to answer bank" on a needs-you answer or an answer Kris typed: offered only for a question
 * the answer bank doesn't have; ticked for a question that will come up again, unticked (with why)
 * for a one-off for this company. Nothing is saved without the tick.
 */
export interface SaveOffer {
  ticked: boolean;
  note: string | null;
}

/** The engine's answer for one field: a value to fill, something for Kris, or a field to leave alone. */
export type FieldAnswer =
  | { fieldId: string; kind: "fill"; value: string; source: FillSource; basis: string | null }
  /** `draft`: a new free-text question drafted from the master profile (`basis` cites the pieces); `save`: see SaveOffer. */
  | { fieldId: string; kind: "needs-you"; reason: string; basis: string | null; suggestion?: string; draft?: string; save?: SaveOffer }
  /** `byRule`: left blank by Kris's answer-bank rule ("Skipped · your rule"). */
  | { fieldId: string; kind: "skip"; reason: string; byRule?: true };

export type Outcome = "filled" | "kept" | "didnt-stick" | "skipped" | "needs-you";

/** What happened to a field when the extension filled the page. */
export interface FieldOutcome {
  fieldId: string;
  outcome: Outcome;
  source: FillSource | null;
}

export interface OutcomeCounts {
  filled: number;
  kept: number;
  needsYou: number;
  didntStick: number;
  skipped: number;
}

/** A page as recorded: counts and, per field, label, kind, outcome and source. Never a value. */
export interface RecordedPage {
  stepLabel: string | null;
  pageKind: PageKind;
  filledAt: string;
  counts: OutcomeCounts;
  /** `empty`: whether the field was empty when the page was read (so a later value is one Kris typed). */
  fields: { label: string; kind: FieldKind; outcome: Outcome; source: FillSource | null; empty: boolean }[];
}

/** An answer Kris typed on the portal into a needs-you or empty field, kept in the session until saved or declined. */
export interface PendingAnswer {
  id: string;
  question: string;
  answer: string;
  kind: AnswerKind;
  save: SaveOffer;
}

/** A page as recorded, with every answer Kris typed on the portal in this session that's still waiting. */
export type RecordedFill = RecordedPage & { typedAnswers: PendingAnswer[] };

/** What "Save to answer bank" saves: an answer typed on the portal (by its id), or one Kris filled from the panel. */
export type SavePick = { pendingId: string } | { question: string; answer: string; kind: AnswerKind };

export interface SavedAnswers {
  /** `added` to the bank; `portal-edit`: the bank has this question with another answer, so Kris chooses in Profile; `same`: nothing to change. */
  saved: { question: string; answerId: string; how: "added" | "portal-edit" | "same" }[];
  refused: { question: string; reason: string }[];
}

export function countOutcomes(outcomes: { outcome: Outcome }[]): OutcomeCounts {
  const counts: OutcomeCounts = { filled: 0, kept: 0, needsYou: 0, didntStick: 0, skipped: 0 };
  for (const o of outcomes) {
    if (o.outcome === "filled") counts.filled++;
    else if (o.outcome === "kept") counts.kept++;
    else if (o.outcome === "needs-you") counts.needsYou++;
    else if (o.outcome === "didnt-stick") counts.didntStick++;
    else counts.skipped++;
  }
  return counts;
}
