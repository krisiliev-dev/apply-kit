// Question matching for Apply's fill engine (spec #23, ticket #40): how alike a portal's question is
// to an answer-bank entry or a package's screening question, whether an answer's kind suits the
// field, and turning an answer into the field's format (an option, a number, a date), all or
// nothing. Pure. Unicode-safe for Bulgarian: letters and digits are `\p{L}\p{N}`, never `\b`.
import type { AnswerKind } from "../preparation/answers.ts";
import type { FieldKind, ReadField } from "./reading.ts";

/** Lower case, accents gone, punctuation as spaces, spaces collapsed (ported from the old `normalizeQuestion`). */
export function normaliseQuestion(raw: string): string {
  return raw.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Little words that don't tell questions apart, in English and Bulgarian. */
const stopWords = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "do", "does", "did", "you", "your", "yours", "what", "which", "how", "to", "of", "in",
  "for", "on", "and", "or", "please", "kindly", "any", "have", "has", "had", "will", "would", "can", "could", "with", "we", "us", "our",
  "i", "me", "my", "if", "this", "that", "these", "those", "it", "its", "at", "as", "by", "from",
  "и", "или", "на", "в", "във", "за", "с", "със", "от", "до", "по", "какъв", "каква", "какво", "какви", "кой", "коя", "кое", "ли", "е",
  "са", "ви", "вие", "вашият", "вашия", "вашата", "вашето", "вашите", "си", "моля", "да", "се", "ще", "можете", "имате",
]);

/** The words that carry a question's meaning. */
export function questionWords(raw: string): string[] {
  const all = normaliseQuestion(raw).split(" ").filter(Boolean);
  const meaningful = all.filter((w) => !stopWords.has(w));
  return meaningful.length > 0 ? meaningful : all;
}

/** 1 for the same words; otherwise the share of words in common (Dice). */
export function similarity(a: string, b: string): number {
  const [wa, wb] = [questionWords(a), questionWords(b)];
  if (wa.length === 0 || wb.length === 0) return 0;
  if (wa.join(" ") === wb.join(" ")) return 1;
  const setB = new Set(wb);
  const common = new Set(wa.filter((w) => setB.has(w))).size;
  return (2 * common) / (new Set(wa).size + setB.size);
}

/** Below Prepare's bar (0.75) but at least this alike: a near match worth naming as "a different question". */
export const nearMissFloor = 0.4;

const kindWords: Record<AnswerKind, string> = { text: "text", "yes-no": "a yes/no", choice: "a choice", number: "a number", date: "a date", rule: "a rule" };
export const answerKindWords = (k: AnswerKind) => kindWords[k];

/** Whether an answer of this kind can go in this field at all (checked for close wordings, not exact ones). */
export function kindFits(kind: AnswerKind, field: FieldKind): boolean {
  const fits: Record<AnswerKind, FieldKind[]> = {
    text: ["text", "textarea", "email", "tel", "url", "select", "radio", "typeahead"],
    "yes-no": ["select", "radio", "typeahead", "checkbox", "text"],
    choice: ["select", "radio", "typeahead", "text"],
    number: ["number", "text", "select", "radio", "typeahead"],
    date: ["date", "text", "select", "radio"],
    rule: ["text", "number", "select", "radio", "typeahead", "textarea"],
  };
  return fits[kind].includes(field);
}

export const fieldKindWords = (f: FieldKind) =>
  f === "textarea" || f === "text" || f === "email" || f === "url" || f === "tel" ? "text" : f === "checkbox" ? "a tick" : f === "number" ? "a number" : f === "date" ? "a date" : "a choice";

/** What an answer's text looks like, for package answers (which carry no kind). */
export function kindOfText(text: string): AnswerKind {
  if (yesNoOf(text)) return "yes-no";
  if (/^-?\d+([.,]\d+)?$/.test(text.trim())) return "number";
  return "text";
}

// ---------------------------------------------------------------- option mapping

const yesWords = new Set(["yes", "y", "true", "да"]);
const noWords = new Set(["no", "n", "false", "не"]);

/** "yes", "no" or null, for answers and options in English or Bulgarian ("Yes, I am" counts as yes). */
export function yesNoOf(text: string): "yes" | "no" | null {
  const first = normaliseQuestion(text).split(" ")[0] ?? "";
  return yesWords.has(first) ? "yes" : noWords.has(first) ? "no" : null;
}

export type Mapped = { ok: true; value: string } | { ok: false; reason: string };

/** The answer in the field's format, all or nothing: exactly one option, a number, a date, or text within the limit. */
export function mapToField(answer: string, field: ReadField): Mapped {
  const value = answer.trim();
  if (field.options.length > 0) return pickOption(value, field.options);
  if (field.kind === "checkbox") {
    const yn = yesNoOf(value);
    return yn === "yes" ? { ok: true, value: "checked" } : yn === "no" ? { ok: true, value: "" } : { ok: false, reason: `"${value}" isn't a yes or no for this tick box` };
  }
  if (field.maxLength !== null && value.length > field.maxLength) {
    return { ok: false, reason: `Your answer is ${value.length.toLocaleString("en-GB")} characters; this field takes ${field.maxLength.toLocaleString("en-GB")}` };
  }
  return { ok: true, value };
}

function pickOption(value: string, options: string[]): Mapped {
  const none: Mapped = { ok: false, reason: `None of the options matches "${value}"` };
  const one = (hits: string[]): Mapped | null => (hits.length === 1 ? { ok: true, value: hits[0]! } : hits.length > 1 ? none : null);
  const norm = normaliseQuestion(value);
  const exact = one(options.filter((o) => normaliseQuestion(o) === norm));
  if (exact) return exact;
  const yn = yesNoOf(value);
  if (yn && (yesWords.has(norm) || noWords.has(norm))) {
    const hit = one(options.filter((o) => yesNoOf(o) === yn));
    if (hit) return hit;
  }
  return none;
}
