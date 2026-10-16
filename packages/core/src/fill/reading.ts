// What Apply's filler reads from a portal page and what comes back for it (Apply spec #23, #38).
// Plain data shared by the fill engine and the extension: the extension reads the page into a
// `PageReading`, the engine answers each field, the extension fills and reports `FieldOutcome`s.
// Browser-safe: types and pure helpers only.
import type { PageJobReference } from "../preparation/contracts.ts";

/** `start`: the portal's "how do you want to apply?" screen (Workday's Autofill with Resume / Apply Manually). */
export type PageKind = "form" | "account" | "sign-in" | "review" | "confirmation" | "posting" | "start" | "other";

/** `repeating`: a section of entries the portal adds with its own Add control (Workday's Work Experience); its value is how many entries it has. */
export type FieldKind = "text" | "email" | "tel" | "url" | "textarea" | "number" | "date" | "select" | "typeahead" | "radio" | "checkbox" | "file" | "repeating";

/** The repeating sections apply-kit fills from the CV: work history and education. */
export type EntrySection = "work" | "education";

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
  /** The field's autocomplete token ("given-name", "email"), when the portal gives one; "month-year" or "year" for a portal's split date inputs. */
  hint: string | null;
  /** A field inside a repeating section's entry (Work Experience 2 › Job Title), or the section itself (a `repeating` field, index 0). */
  entry?: { section: EntrySection; index: number } | null;
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

/** Which of the package's files a file field gets. */
export type PackageFileKind = "cv" | "letter";

/** Where a filled value came from, as the panel names it. */
export type FillSource = "profile" | "answer-bank" | "package" | "cv-version" | "you";

/** The engine's answer for one field: a value to fill, something for Kris, or a field to leave alone. */
export type FieldAnswer =
  | { fieldId: string; kind: "fill"; value: string; source: FillSource; basis: string | null }
  /** Attach the package's frozen CV or letter: the extension fetches its bytes (`packageFile`) and attaches them first. */
  | { fieldId: string; kind: "file"; which: PackageFileKind; fileName: string; size: number; source: "package"; basis: string }
  | { fieldId: string; kind: "needs-you"; reason: string; basis: string | null; suggestion?: string }
  /** `byRule`: left blank by Kris's answer-bank rule ("Skipped · your rule"). */
  | { fieldId: string; kind: "skip"; reason: string; byRule?: true }
  /**
   * A repeating section: add this many entries with the portal's own Add control (never more than the
   * CV has), and the entries the portal added itself that repeat a CV entry, reported, removed only on Kris's click.
   */
  | { fieldId: string; kind: "entries"; section: EntrySection; add: number; duplicates: DuplicateEntry[]; source: "cv-version"; basis: string };

/** An entry the portal added (Workday reading the CV) that repeats one of the CV's entries. */
export interface DuplicateEntry {
  /** Its position in the section, from 1, as the portal numbers it ("Work Experience 4"). */
  index: number;
  /** "Junior Security Analyst, Orbital Bank, 2023–2025". */
  words: string;
}

export type Outcome = "filled" | "kept" | "didnt-stick" | "skipped" | "needs-you";

/** What happened to a field when the extension filled the page. */
export interface FieldOutcome {
  fieldId: string;
  outcome: Outcome;
  source: FillSource | null;
  /** A typeahead or list with more than one plausible match: the options for Kris to choose between. */
  choices?: string[];
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
  fields: { label: string; kind: FieldKind; outcome: Outcome; source: FillSource | null }[];
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
