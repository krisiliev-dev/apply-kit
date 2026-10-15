// The cover letter (ticket #65), pure: a draft as sentences (each marked when it was written for
// this company, with the pieces it relies on), the text Kris edits, its word count, and the checks
// it must pass. The checks hold the letter to the master profile (the honesty validator's hard
// rules), to the CV's decisions (the wording Kris chose, never the stronger one; the gaps she chose
// to name, named; the ones she left out, left out), to a stock-phrase list, and ask for one concrete
// example with a number.
import type { WrittenLetter } from "../writing/writer.ts";
import { wordCount } from "./voice.ts";

export interface LetterSentence {
  text: string;
  /** Written for this company: highlighted for Kris to check first (never in the PDF). */
  forCompany: boolean;
  /** The pieces it relies on. Null for a sentence Kris wrote or changed: it is held to the whole profile. */
  pieceIds: string[] | null;
}

/** A draft: greeting, the body's paragraphs of sentences, and the closing (the name is signed under it). */
export interface LetterDraft {
  greeting: string;
  paragraphs: LetterSentence[][];
  closing: string;
}

/** The default length of a letter's body, in words. */
export const LETTER_WORDS = 220;

/** The writer's letter as a draft, trimmed. */
export const fromWritten = (w: WrittenLetter): LetterDraft => ({
  greeting: w.greeting.trim(),
  paragraphs: w.paragraphs
    .map((p) => p.sentences.map((s) => ({ text: s.text.trim(), forCompany: s.forCompany, pieceIds: [...new Set(s.pieceIds)] })).filter((s) => s.text))
    .filter((p) => p.length),
  closing: w.closing.trim(),
});

/** A draft Kris writes herself: the greeting and closing, and an empty body. */
export const emptyLetter = (company: string, language: "en" | "bg"): LetterDraft => (language === "bg"
  ? { greeting: "Здравейте,", paragraphs: [], closing: "Поздрави," }
  : { greeting: `Dear ${company} hiring team,`, paragraphs: [], closing: "Kind regards," });

const paragraphText = (p: LetterSentence[]) => p.map((s) => s.text).join(" ");

/** The body's paragraphs as text. */
export const bodyParagraphs = (d: LetterDraft) => d.paragraphs.map(paragraphText);

/** The words in the body (the greeting and closing don't count). */
export const bodyWords = (d: LetterDraft) => wordCount(bodyParagraphs(d).join(" "));

/** The draft as Kris edits it: the greeting, the paragraphs and the closing, separated by blank lines. */
export const letterText = (d: LetterDraft) => [d.greeting, ...bodyParagraphs(d), d.closing].filter(Boolean).join("\n\n");

/** A paragraph's sentences. */
const sentencesOf = (paragraph: string) => paragraph.replace(/\s+/g, " ").trim().split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}"“„'(])/u).map((s) => s.trim()).filter(Boolean);

const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

/**
 * Kris's text back as a draft. The first block is the greeting when it is a short line ending in a
 * comma; the last block is the closing when it is a short line ending in a comma (a signed name under
 * it is dropped: the template signs it). A sentence left as the draft had it keeps its mark and
 * pieces; one Kris changed or added is hers: no mark, held to the whole profile.
 */
export function parseLetterText(text: string, before: LetterDraft): LetterDraft {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const short = (b: string | undefined) => !!b && wordCount(b.split("\n")[0]!) <= 8 && /[,!]$/.test(b.split("\n")[0]!.trim());
  const greeting = short(blocks[0]) && !blocks[0]!.includes("\n") ? blocks.shift()! : "";
  const last = blocks.at(-1);
  const closing = blocks.length && short(last) && last!.split("\n").length <= 2 ? blocks.pop()!.split("\n")[0]!.trim() : "";
  const known = new Map(before.paragraphs.flat().map((s) => [norm(s.text), s]));
  return {
    greeting,
    paragraphs: blocks.map((b) => sentencesOf(b).map((t) => known.get(norm(t)) ?? { text: t, forCompany: false, pieceIds: null })),
    closing,
  };
}

const ordinal = (n: number) => ["first", "second", "third", "fourth", "fifth", "sixth"][n - 1] ?? `${n}th`;

/**
 * Where the sentences written for this company are, in words, so the highlight is never only a
 * colour: "the first sentence of paragraph 1 and the first two sentences of paragraph 3".
 */
export function forCompanyPlaces(d: LetterDraft): string | null {
  const parts = d.paragraphs.flatMap((p, i) => {
    const at = p.map((s, j) => (s.forCompany ? j + 1 : 0)).filter(Boolean);
    if (!at.length) return [];
    const run = at.every((n, k) => n === k + 1);
    const where = at.length === p.length ? (p.length === 1 ? "the sentence" : `all ${p.length} sentences`)
      : run ? (at.length === 1 ? "the first sentence" : `the first ${at.length} sentences`)
      : at.length === 1 ? `the ${ordinal(at[0]!)} sentence` : `sentences ${at.join(", ")}`;
    return [`${where} of paragraph ${i + 1}`];
  });
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** Sentences marked as written for this company. */
export const forCompanyCount = (d: LetterDraft) => d.paragraphs.flat().filter((s) => s.forCompany).length;
