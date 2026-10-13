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
// A number with an optional decimal part and thousands suffix, then % or "per cent"; or a fraction in words.
const pattern = new RegExp(
  String.raw`(?<![\p{L}\p{N}])${hedge}(?:(\d+(?:[.,]\d+)?)(k)?(\s?%|\s?per\s?cent|\s?percent|\s?процента)?|(${fractionWords}))(?![\p{L}\p{N}])`,
  "giu",
);

export function quantities(text: string): Quantity[] {
  const found: Quantity[] = [];
  for (const m of text.matchAll(pattern)) {
    const [raw, digits, thousands, percent, words] = m;
    if (words) {
      found.push({ kind: "proportion", value: fractions[words.toLowerCase().replace(/[\s-]+/g, " ")]!, raw: raw.trim(), index: m.index });
      continue;
    }
    const n = Number(digits!.replace(",", ".")) * (thousands ? 1000 : 1);
    if (!percent && !thousands && /^\d{4}$/.test(digits!) && n >= 1950 && n <= 2099) continue;
    found.push({ kind: percent ? "proportion" : "count", value: percent ? n / 100 : n, raw: raw.trim(), index: m.index });
  }
  return found;
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
