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

/** `basis` says how a value was worked out ("counted from today"), when it isn't the answer as written. */
export type Mapped = { ok: true; value: string; basis?: string } | { ok: false; reason: string };

/** The answer in the field's format, all or nothing: exactly one option, a number, a date, or text within the limit. */
export function mapToField(answer: string, field: ReadField, today: Date): Mapped {
  const value = answer.trim();
  if (field.options.length > 0) return pickOption(value, field.options);
  if (field.kind === "date") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: true, value };
    const days = daysIn(value);
    if (days === null) return { ok: false, reason: `"${value}" isn't a date apply-kit can work out` };
    return { ok: true, value: new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10), basis: `"${value}", counted from today` };
  }
  if (field.kind === "number" && !/^-?\d+([.,]\d+)?$/.test(value)) return { ok: false, reason: `"${value}" isn't a number` };
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
  if (yn && (yesWords.has(norm) || noWords.has(norm))) return one(options.filter((o) => yesNoOf(o) === yn)) ?? none;
  if (preferNot.test(norm)) return one(options.filter((o) => preferNot.test(normaliseQuestion(o)))) ?? none;
  // A length of time ("1 month") goes in the bucket that holds it; a number in the range that holds it.
  const days = daysIn(value);
  if (days !== null) return one(options.filter((o) => holds(bucketOf(o, true), days))) ?? none;
  if (/^\d+([.,]\d+)?$/.test(value)) {
    const n = Number(value.replace(",", "."));
    return one(options.filter((o) => holds(bucketOf(o, false), n))) ?? none;
  }
  return none;
}

/** "Prefer not to say" and the ways portals word it. */
const preferNot = /^(i )?(prefer not to (say|answer|disclose)|decline to (self identify|answer|state)|i (do not|don t) wish to (answer|disclose)|предпочитам да не)/u;

const units: [RegExp, number][] = [[/^(day|days|ден|дни|дена)$/u, 1], [/^(week|weeks|седмица|седмици)$/u, 7], [/^(month|months|месец|месеца|месеци)$/u, 30]];
const numberWords: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, six: 6, един: 1, една: 1, два: 2, две: 2, три: 3, четири: 4, шест: 6 };
const unitOf = (w: string | undefined) => (w ? units.find(([re]) => re.test(w))?.[1] ?? null : null);
const amountOf = (w: string | undefined) => (w === undefined ? null : /^\d+$/.test(w) ? Number(w) : numberWords[w] ?? null);

/** A length of time in days ("1 month" → 30, "two weeks from offer" → 14, "immediately" → 0), or null. */
export function daysIn(text: string): number | null {
  const w = normaliseQuestion(text).split(" ");
  if (/^(immediately|now|asap|веднага|незабавно)$/u.test(w[0] ?? "")) return 0;
  const unit = unitOf(w[1]);
  const amount = amountOf(w[0]);
  return unit !== null && amount !== null ? amount * unit : null;
}

/** The span an option covers, in days (time) or plain numbers: "2–4 weeks", "Less than 2 weeks", "6+", "1 month". */
function bucketOf(option: string, time: boolean): [number, number] | null {
  const w = normaliseQuestion(option.replace(/(\d)\s*\+/u, "$1 plus")).split(" ");
  if (time && /^(immediately|now|веднага|незабавно)$/u.test(w[0] ?? "")) return [0, 0];
  const nums = w.map((x) => amountOf(x));
  const unit = time ? w.map(unitOf).find((u) => u !== null) ?? null : 1;
  if (unit === null) return null;
  const at = nums.findIndex((n) => n !== null);
  if (at < 0) return null;
  const first = nums[at]! * unit;
  const second = nums.slice(at + 1).find((n) => n !== null);
  const before = w.slice(0, at).join(" ");
  const after = w.slice(at + 1).join(" ");
  if (/(less than|under|fewer than|до|по малко от)$/u.test(before)) return [0, first - 1];
  if (/(up to)$/u.test(before)) return [0, first];
  if (/(more than|over|над|повече от)$/u.test(before)) return [first + 1, Infinity];
  if (/\b(plus|or more)\b/u.test(after) || /^(at least)$/u.test(before)) return [first, Infinity];
  if (second != null) return [first, second * unit];
  return [first, first];
}

const holds = (span: [number, number] | null, n: number) => span !== null && n >= span[0] && n <= span[1];

/** Diversity topics portals ask about in their own words, and the wording the answer bank's rule knows them by. */
const diversityTopics: [RegExp, string][] = [
  [/hispanic|latin|race|racial|ethnic|етническ/u, "Ethnicity"],
  [/gender|пол$/u, "Gender"],
  [/veteran/u, "Protected veteran status"],
  [/disabilit|увреждан/u, "Disability"],
  [/sexual orientation|lgbt/u, "Sexual orientation"],
];

/** The bank's wording for a voluntary diversity question's topic, or null when it isn't one. */
export function diversityTopic(label: string): string | null {
  const q = normaliseQuestion(label);
  return diversityTopics.find(([re]) => re.test(q))?.[1] ?? null;
}
