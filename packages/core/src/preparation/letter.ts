// The cover letter (ticket #65), pure: a draft as sentences (each marked when it was written for
// this company, with the pieces it relies on), the text Kris edits, its word count, and the checks
// it must pass. The checks hold the letter to the master profile (the honesty validator's hard
// rules), to the CV's decisions (the wording Kris chose, never the stronger one; the gaps she chose
// to name, named; the ones she left out, left out), to a stock-phrase list, and ask for one concrete
// example with a number.
import type { WrittenLetter } from "../writing/writer.ts";
import { checkWording, quoteOf, type HonestyProfile } from "./honesty.ts";
import { quantities } from "./numbers.ts";
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

// ---------------------------------------------------------------- checks

/** A decision on a CV line: the wording Kris chose, the stronger one it replaced, and the pieces behind it. */
export interface LetterDecision {
  chosen: string;
  draft: string;
  pieceIds: string[];
  /** The profile's wording for the line, when there is one. */
  piece: string | null;
}

export interface LetterCheckContext {
  /** The profile, as for the CV: the posting's company and title (and the requirements it has evidence for) may be named too. */
  profile: HonestyProfile;
  /** Decisions on near-the-line wording in the CV. */
  decisions: LetterDecision[];
  /** Gaps (required items with no evidence) Kris chose to name in the letter, and the ones she left out of both. */
  named: string[];
  leftOut: string[];
  language: "en" | "bg";
}

export type LetterCheckId = "trace" | "decisions" | "gaps" | "stock" | "example";

export interface LetterCheck {
  id: LetterCheckId;
  /** A problem stops Approve (the honesty line, the CV's decisions); a warning is advice. */
  state: "ok" | "problem" | "warning";
  label: string;
  detail: string | null;
  /** For a problem: why Approve waits, finishing "The cover letter can't be approved yet: …". */
  because: string | null;
}

/** Stock phrases, as rules (from the old project's banned-phrase list), not a score. */
export const stockPhrases: Record<"en" | "bg", string[]> = {
  en: [
    "passionate", "excited to apply", "thrilled", "results-driven", "dynamic", "synergy", "team player", "go-getter",
    "I believe", "I think", "I feel", "looking forward to hearing", "thank you for considering", "thanks for considering",
    "do not hesitate to contact", "don't hesitate to contact", "feel free to contact",
  ],
  bg: ["страстен", "страстна", "развълнуван", "развълнувана", "ориентиран към резултати", "ориентирана към резултати", "динамичен", "динамична", "синергия", "отборен играч", "с нетърпение очаквам", "не се колебайте да се свържете"],
};

const words = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).map((w) => w.replace(/['’]s$/, ""));

/** A word's stem, roughly: enough that "led", "leads" and "leading" are one claim. */
const stem = (w: string) => (w === "led" ? "lead" : w.replace(/(?:ing|ed|es|s)$/, "") || w);

/** Words that make a claim stronger than the same line without them. */
const strongWords = new Set([
  "all", "every", "each", "entire", "whole", "sole", "solely", "single-handedly", "always", "lead", "head", "own", "manage", "spearhead", "architect", "drive",
  "всички", "всеки", "всяка", "всяко", "цял", "целия", "цялата", "сам", "сама", "самостоятелно", "винаги", "ръководих", "водих", "управлявах",
].map(stem));

const stopWords = new Set("a an the and or of to in on at for with by from as is are was were be been it its this that these those i me my we our you your he she they them their than then so but not no".split(" "));
const content = (s: string) => new Set(words(s).filter((w) => !stopWords.has(w) && w.length > 2).map(stem));

/** Whether a sentence says something about Kris: first person. */
function firstPerson(text: string, language: "en" | "bg"): boolean {
  return language === "bg"
    ? /(^|[^\p{L}])(аз|ми|мен|мене|мой|моя|моят|моите|моето|моята)(?=[^\p{L}]|$)|[\p{L}]{3,}(ах|ях|их)(?=[^\p{L}]|$)/iu.test(text)
    : /(^|[^\p{L}])(I|I'm|I've|I'd|I'll|I’m|I’ve|I’d|I’ll)(?=[^\p{L}]|$)|(^|[^\p{L}])(me|my|mine|myself)(?=[^\p{L}]|$)/u.test(text);
}

/** Whether a sentence reads as naming a gap: something not done yet, or to learn. */
const gapPhrase = (text: string) => /(^|[^\p{L}])(not|never|yet|learn|learning|new to|gap|не|нямам|още|уча|науча|липса)(?=[^\p{L}]|$)|n['’]t\b/iu.test(text);

/** The words that name a requirement: its capitalised names, or else its longest word. */
function keyWords(requirement: string): string[] {
  const names = (requirement.match(/(?<=\s)[\p{Lu}][\p{L}\p{N}+#.-]*|[\p{L}]*[\p{Lu}][\p{L}]*[\p{Lu}][\p{L}\p{N}]*/gu) ?? []).map((w) => w.toLowerCase());
  if (names.length) return [...new Set(names)];
  const longest = words(requirement).filter((w) => !stopWords.has(w)).sort((a, b) => b.length - a.length)[0];
  return longest ? [longest] : [];
}
const mentions = (text: string, requirement: string) => {
  const have = new Set(words(text));
  const key = keyWords(requirement);
  return key.length > 0 && key.every((w) => have.has(w));
};

/** A sentence as a check quotes it, whole. */
const quoted = (s: string) => `"${s.trim().replace(/[.!?]$/, "")}"`;

/**
 * The letter's checks: every claim traces to the profile; the wording agrees with the CV's decisions
 * (never the stronger wording, never a gap Kris left out); the gaps chosen to be named are named; no
 * stock phrases; one concrete example with a number.
 */
export function checkLetter(d: LetterDraft, ctx: LetterCheckContext): LetterCheck[] {
  const sentences = d.paragraphs.flat();
  const usable = ctx.profile.pieces.filter((p) => p.status === "confirmed" || ctx.profile.packagePieces?.includes(p.id));
  const allIds = usable.map((p) => p.id);
  const ok = (id: LetterCheckId, label: string): LetterCheck => ({ id, state: "ok", label, detail: null, because: null });

  // Every claim traces to the profile: a sentence citing pieces is held to them; one about Kris that
  // cites none (or that Kris wrote) to the whole profile. Gaps may be named where a sentence says so.
  const traced = sentences.flatMap((s) => {
    const cited = s.pieceIds?.length ? s.pieceIds : null;
    if (!cited && !firstPerson(s.text, ctx.language)) return [];
    const alsoNamed = [...(ctx.profile.alsoNamed ?? []), ...(gapPhrase(s.text) ? [...ctx.named, ...ctx.leftOut] : [])];
    const problems = checkWording(s.text, cited ?? allIds, { ...ctx.profile, alsoNamed });
    return problems.length ? [{ s, message: problems.map((p) => p.message).join("; it ") }] : [];
  });
  const trace: LetterCheck = traced.length === 0 ? ok("trace", "Every claim traces to your master profile") : {
    id: "trace", state: "problem",
    label: traced.length === 1 ? "A claim doesn't trace to your master profile" : `${traced.length} claims don't trace to your master profile`,
    detail: traced.map((x) => `${quoted(x.s.text)} ${x.message}.`).join(" "),
    because: `it says something your profile doesn't back: ${quoted(traced[0]!.s.text)} ${traced[0]!.message}.`,
  };

  // The CV's decisions: a sentence about a decided line never carries the stronger wording's claim.
  const contradictions = ctx.decisions.flatMap((dec) => {
    const chosen = new Set(words(dec.chosen).map(stem));
    const strong = [...new Set(words(dec.draft).map(stem))].filter((w) => !chosen.has(w) && (strongWords.has(w) || /^\d/.test(w)));
    if (!strong.length) return [];
    const about = new Set([...content(dec.piece ?? ""), ...content(dec.chosen)]);
    return sentences.flatMap((s) => {
      const related = s.pieceIds?.some((id) => dec.pieceIds.includes(id)) || [...content(s.text)].filter((w) => about.has(w)).length >= 2;
      const said = new Set(words(s.text).map(stem));
      const found = strong.filter((w) => said.has(w));
      if (!related || !found.length) return [];
      const shown = words(s.text).find((w) => stem(w) === found[0]) ?? found[0]!;
      return [{ s, dec, word: shown }];
    });
  });
  const leftOut = ctx.leftOut.flatMap((gap) => sentences.filter((s) => mentions(s.text, gap)).map((s) => ({ s, gap })));
  const decisions: LetterCheck = contradictions.length ? {
    id: "decisions", state: "problem",
    label: `Contradicts your CV decision: "${quoteOf(contradictions[0]!.dec.chosen)}"`,
    detail: contradictions.map((c) => `${quoted(c.s.text)} says "${c.word}", which your CV decision doesn't.`).join(" ") + " Use the CV's wording, or ask for a new draft.",
    because: `it contradicts your CV decision: "${quoteOf(contradictions[0]!.dec.chosen)}".`,
  } : leftOut.length ? {
    id: "decisions", state: "problem",
    label: `Names ${leftOut[0]!.gap}, which you chose to leave out`,
    detail: `${quoted(leftOut[0]!.s.text)} mentions it. In the CV step you chose to leave it out of both the CV and the letter.`,
    because: `it names ${leftOut[0]!.gap}, which you chose to leave out of both.`,
  } : ok("decisions", ctx.decisions.length === 1 ? `Wording matches your CV decision: "${quoteOf(ctx.decisions[0]!.chosen)}"`
    : ctx.decisions.length ? `Wording matches your ${ctx.decisions.length} CV decisions` : "Wording matches your CV");

  // The gaps Kris chose to name, named.
  const missing = ctx.named.filter((gap) => !sentences.some((s) => mentions(s.text, gap)));
  const gaps: LetterCheck = ctx.named.length === 0 ? ok("gaps", "No gap to name: you chose none in the CV step")
    : missing.length ? {
      id: "gaps", state: "problem",
      label: `${missing[0]} gap not named`,
      detail: `You chose to name ${missing.join(" and ")} in the letter, as something to learn. Ask for a new draft ("Name the ${missing[0]} gap"), or add a sentence yourself.`,
      because: `it doesn't name the ${missing[0]} gap, as you chose in the CV step.`,
    }
    : ok("gaps", ctx.named.length === 1 ? `${ctx.named[0]} gap named, as you chose in the CV step` : `${ctx.named.join(" and ")} gaps named, as you chose in the CV step`);

  // Stock phrases, as rules.
  const all = [d.greeting, ...sentences.map((s) => s.text), d.closing];
  const stock = stockPhrases[ctx.language].flatMap((phrase) => {
    const re = new RegExp(`(?<![\\p{L}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’]")}(?![\\p{L}])`, "iu");
    const at = all.find((t) => re.test(t));
    return at ? [{ phrase, at }] : [];
  });
  const stockCheck: LetterCheck = stock.length === 0 ? ok("stock", ctx.language === "bg" ? "No stock phrases (\"страстен\", \"развълнуван\")" : "No stock phrases (\"passionate\", \"excited to apply\")") : {
    id: "stock", state: "warning",
    label: `Stock ${stock.length === 1 ? "phrase" : "phrases"}: ${stock.map((x) => `"${x.phrase}"`).join(", ")}`,
    detail: `In ${quoted(stock[0]!.at)}. Say what you did instead.`,
    because: null,
  };

  // One concrete example from the profile, with a number.
  const achievements = new Set(usable.filter((p) => p.kind === "achievement").map((p) => p.id));
  const example = sentences.some((s) => quantities(s.text).length > 0
    && (s.pieceIds === null ? firstPerson(s.text, ctx.language) : s.pieceIds.some((id) => achievements.has(id))));
  const exampleCheck: LetterCheck = example ? ok("example", "One concrete example with a number") : {
    id: "example", state: "warning", label: "No concrete example with a number",
    detail: "Anchor the letter in one example from your profile, with its number.", because: null,
  };

  return [trace, decisions, gaps, stockCheck, exampleCheck];
}
