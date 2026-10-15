// Numbers in a profile piece and in its source, compared so a piece never states more than its source
// does. Percentages and fractions in words ("about a third", "half") are proportions; other numbers
// are counts. A year (1950–2099 written where a date goes: "in 2023", "since 2019", "March 2024",
// "2019–2022") is a date, not a claim; the same digits elsewhere ("onboarded 2000 customers") are a
// count. Bulgarian fraction words and dates are read too.

export type QuantityKind = "proportion" | "count";

/**
 * Which way a hedge points: "nearly 30%" and "up to 30%" say the number is at most 30% ("below"),
 * "over 30%" says more ("above"), "about 30%" is rounding either way ("around").
 */
export type HedgeDirection = "below" | "around" | "above";

export interface Quantity {
  kind: QuantityKind;
  value: number;
  /** The words as written, with a hedge before them ("about a third", "over 20"). */
  raw: string;
  index: number;
  /** The hedge before the number, if there is one. */
  hedge: { direction: HedgeDirection; words: string } | null;
}

const hedges: Record<HedgeDirection, string[]> = {
  below: ["nearly", "almost", "under", "less than", "up to", "почти", "близо"],
  around: ["about", "around", "roughly", "approximately", "около"],
  above: ["over", "more than", "над"],
};
const hedgeWords = Object.values(hedges).flat().sort((a, b) => b.length - a.length).map((w) => w.replace(/ /g, String.raw`\s+`)).join("|");
const hedge = String.raw`(?:(?:${hedgeWords})\s+)?`;
const leadingHedge = new RegExp(String.raw`^(${hedgeWords})\s+`, "iu");

function hedgeOf(raw: string): Quantity["hedge"] {
  const words = leadingHedge.exec(raw)?.[1]?.toLowerCase().replace(/\s+/g, " ");
  if (!words) return null;
  const direction = (Object.keys(hedges) as HedgeDirection[]).find((d) => hedges[d].includes(words))!;
  return { direction, words };
}
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

// Where a four-digit number reads as a year: after a date word or a month, in a range of years, or
// before the Bulgarian year mark ("2024 г."). "From" and "to" alone are too often counts ("from 1200
// to 2000 users"), so they count only in a range of two years.
const month = String.raw`jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|януари|февруари|март|април|май|юни|юли|август|септември|октомври|ноември|декември`;
const dateBefore = new RegExp(
  String.raw`(?:(?<![\p{L}])(?:in|since|until|till|during|в|във|през)\s+(?:(?:early|late|mid|the\s+(?:spring|summer|autumn|fall|winter)\s+of|spring|summer|autumn|fall|winter|началото\s+на|края\s+на)\s+|mid-)?|(?<![\p{L}])(?:${month})\.?\s+|(?<![\p{L}])[QH][1-4]\s+|\d{1,2}[./]|(?:19|20)\d\d\s*(?:[–—-]|to|until|till|до)\s*)$`,
  "iu",
);
const dateAfter = /^(?:\s*(?:[–—-]|to|until|till|до)\s*(?:(?:19|20)\d\d(?!\d)|present|now|today|днес|сега)|\s*г\.?(?![\p{L}])|\s+год(?:ина|\.)|-\d\d(?!\d)|\/\d\d(?!\d))/iu;
const isDate = (before: string, after: string) => dateBefore.test(before) || dateAfter.test(after);

/** The numbers in a piece's text, or (with `source`) in the words a piece came from, which also reads "one". */
export function quantities(text: string, { source = false }: { source?: boolean } = {}): Quantity[] {
  const found: Quantity[] = [];
  for (const m of text.matchAll(source ? sourceWords : claimWords)) {
    const word = m[1]!.toLowerCase();
    found.push({ kind: "count", value: countWords[word] ?? oneWords[word]!, raw: m[0].trim(), index: m.index, hedge: hedgeOf(m[0]) });
  }
  for (const m of text.matchAll(pattern)) {
    const raw = m[0];
    const { digits, sep, k: thousands, percent, words } = m.groups!;
    if (words) {
      found.push({ kind: "proportion", value: fractions[words.toLowerCase().replace(/[\s-]+/g, " ")]!, raw: raw.trim(), index: m.index, hedge: hedgeOf(raw) });
      continue;
    }
    const n = Number(sep ? digits!.split(sep).join("") : digits!.replace(",", ".")) * (thousands ? 1000 : 1);
    if (!percent && !thousands && /^\d{4}$/.test(digits!) && n >= 1950 && n <= 2099 && isDate(text.slice(0, m.index), text.slice(m.index + raw.length))) continue;
    found.push({ kind: percent ? "proportion" : "count", value: percent ? n / 100 : n, raw: raw.trim(), index: m.index, hedge: hedgeOf(raw) });
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * A claim keeps its source's hedge, or a weaker one; it never makes the number stronger:
 * - a source hedged below ("nearly 30%", "up to 30%") stays hedged below: not "30%", "about 30%" or "over 30%";
 * - a claim hedged above ("over 30%") needs a source hedged above too.
 * Rounding hedges ("about", "around") may be dropped or added: favourable rounding (`within`)
 * already allows that much ("about a third" → 35%). Hedging a bare number ("30%" → "nearly 30%") is weaker, so allowed.
 */
export function keepsHedge(claim: Quantity, source: Quantity): boolean {
  if (source.hedge?.direction === "below" && claim.hedge?.direction !== "below") return false;
  if (claim.hedge?.direction === "above" && source.hedge?.direction !== "above") return false;
  return true;
}

/** Favourable but plausible rounding: within a tenth of the source's number ("about a third" → 30% or 35%, not 50%), keeping its hedge. */
export function within(claim: Quantity, source: Quantity): boolean {
  return claim.kind === source.kind && Math.abs(claim.value - source.value) <= source.value * 0.1 + 1e-9 && keepsHedge(claim, source);
}

/** Stated exactly as the source has it: the same number, keeping its hedge. */
export function exactly(claim: Quantity, source: Quantity): boolean {
  return claim.kind === source.kind && Math.abs(claim.value - source.value) < 1e-9 && keepsHedge(claim, source);
}

/** The source's number closest to a claim of the same kind, if it has any. */
export function closest(claim: Quantity, source: Quantity[]): Quantity | null {
  const same = source.filter((q) => q.kind === claim.kind);
  return same.sort((a, b) => Math.abs(a.value - claim.value) - Math.abs(b.value - claim.value))[0] ?? null;
}

/** "33%" for a third; the way a proportion reads as a whole percentage, keeping a hedge that points one way ("nearly 33%"). */
export const asPercent = (q: Quantity) => `${q.hedge && q.hedge.direction !== "around" ? `${q.hedge.words} ` : ""}${Math.round(q.value * 100)}%`;
