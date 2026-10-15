// Numbers in a profile piece and in its source, compared so a piece never states more than its source
// does. Percentages and fractions in words ("about a third", "half") are proportions; other numbers
// are counts. Years (1950–2099) are dates, not claims. Bulgarian fraction words are read too.

export type QuantityKind = "proportion" | "count";

export interface Quantity {
  kind: QuantityKind;
  value: number;
  /** The words as written, with a hedge before them ("about a third", "over 20"). */
  raw: string;
  index: number;
}

const hedge = String.raw`(?:(?:about|around|roughly|nearly|almost|approximately|over|more than|under|less than|up to|около|над|почти|близо)\s+)?`;
const fractions: Record<string, number> = {
  "a half": 0.5, half: 0.5, "one half": 0.5,
  "a third": 1 / 3, "one third": 1 / 3, "two thirds": 2 / 3,
  "a quarter": 0.25, "one quarter": 0.25, "three quarters": 0.75,
  "a fifth": 0.2, "one fifth": 0.2,
  "една трета": 1 / 3, "две трети": 2 / 3, "половина": 0.5, "наполовина": 0.5, "една четвърт": 0.25,
};
const fractionWords = Object.keys(fractions).sort((a, b) => b.length - a.length).map((w) => w.replace(/ /g, String.raw`[\s-]+`)).join("|");
// A number, then an optional thousands suffix, then % or "per cent"; or a fraction in words. A
// comma or space followed by exactly three digits groups thousands ("1,500", "12 000"); otherwise a
// comma or point starts a decimal part ("1.5", "2,5").
const pattern = new RegExp(
  String.raw`(?<![\p{L}\p{N}])${hedge}(?:(?<digits>\d{1,3}(?<sep>[, \u00a0\u202f])\d{3}(?:\k<sep>\d{3})*(?:\.\d+)?(?!\d)|\d+(?:[.,]\d+)?)(?<k>k)?(?<percent>\s?%|\s?per\s?cent|\s?percent|\s?процента)?|(?<words>${fractionWords}))(?![\p{L}\p{N}])`,
  "giu",
);

// Small counts written as words. "One" (and "един") is read only in a source: in a piece it's too
// often not a number at all ("one of the first"), and a piece with a number should show it as a digit.
const countWords: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  два: 2, две: 2, три: 3, четири: 4, пет: 5, шест: 6, седем: 7, осем: 8, девет: 9, десет: 10,
};
const oneWords: Record<string, number> = { one: 1, един: 1, една: 1, едно: 1 };
const wordPattern = (words: string[]) => new RegExp(String.raw`(?<![\p{L}\p{N}])${hedge}(${words.join("|")})(?![\p{L}\p{N}])`, "giu");
const claimWords = wordPattern(Object.keys(countWords));
const sourceWords = wordPattern([...Object.keys(countWords), ...Object.keys(oneWords)]);

/** The numbers in a piece's text, or (with `source`) in the words a piece came from, which also reads "one". */
export function quantities(text: string, { source = false }: { source?: boolean } = {}): Quantity[] {
  const found: Quantity[] = [];
  for (const m of text.matchAll(source ? sourceWords : claimWords)) {
    const word = m[1]!.toLowerCase();
    found.push({ kind: "count", value: countWords[word] ?? oneWords[word]!, raw: m[0].trim(), index: m.index });
  }
  for (const m of text.matchAll(pattern)) {
    const raw = m[0];
    const { digits, sep, k: thousands, percent, words } = m.groups!;
    if (words) {
      found.push({ kind: "proportion", value: fractions[words.toLowerCase().replace(/[\s-]+/g, " ")]!, raw: raw.trim(), index: m.index });
      continue;
    }
    const n = Number(sep ? digits!.split(sep).join("") : digits!.replace(",", ".")) * (thousands ? 1000 : 1);
    if (!percent && !thousands && /^\d{4}$/.test(digits!) && n >= 1950 && n <= 2099) continue;
    found.push({ kind: percent ? "proportion" : "count", value: percent ? n / 100 : n, raw: raw.trim(), index: m.index });
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Favourable but plausible rounding: within a tenth of the source's number ("about a third" → 30% or 35%, not 50%). */
export function within(claim: Quantity, source: Quantity): boolean {
  return claim.kind === source.kind && Math.abs(claim.value - source.value) <= source.value * 0.1 + 1e-9;
}

/** The source's number closest to a claim of the same kind, if it has any. */
export function closest(claim: Quantity, source: Quantity[]): Quantity | null {
  const same = source.filter((q) => q.kind === claim.kind);
  return same.sort((a, b) => Math.abs(a.value - claim.value) - Math.abs(b.value - claim.value))[0] ?? null;
}

/** "33%" for a third; the way a proportion reads as a whole percentage. */
export const asPercent = (q: Quantity) => `${Math.round(q.value * 100)}%`;
