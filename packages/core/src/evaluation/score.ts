// Scoring one extraction against its hand label, fact type by fact type. Pure functions.
// Lists (requirements, years, languages, certificates, locations) are matched one-to-one, so a
// fact can only be credited once; single facts (remote rule, visa, salary, language) are right or wrong.
import type { PostingFacts } from "../extraction/facts.ts";
import type { ExpectedFacts } from "./labels.ts";

export interface ListScore {
  expected: number;
  extracted: number;
  matched: number;
  /** Of the matched pairs, how many agree on required vs preferred (null for locations). */
  kindAgreed: number | null;
  /** Labelled facts the extractor didn't find, as labelled. */
  missed: string[];
  /** Extracted facts with no labelled counterpart, as extracted. */
  extra: string[];
}

export interface CaseScore {
  requirements: ListScore;
  years: ListScore;
  languages: ListScore;
  certificates: ListScore;
  /** The places the job is tied to or open to (remote.locations). */
  locations: ListScore;
  /** Remote mode (on-site, hybrid, remote, not stated) exactly as labelled. */
  remote: boolean;
  /** Visa sponsorship (offered, not offered, not stated) exactly as labelled. */
  workAuthorisation: boolean;
  /** Not stated, or exactly the labelled amounts, currency, period and gross/net. */
  salary: boolean;
  /** The posting's language code. */
  language: boolean;
}

/** Words that carry no meaning of their own in a requirement ("experience with", "strong"). */
const filler = new Set([
  "a", "an", "and", "the", "of", "in", "on", "with", "for", "to", "at", "as", "by", "or", "is", "are", "be",
  "years", "year", "yrs", "experience", "experienced", "knowledge", "skills", "skill", "strong", "good", "solid",
  "excellent", "proven", "understanding", "ability", "able", "proficiency", "proficient", "familiarity",
  "familiar", "working", "hands-on", "hands", "practical", "deep", "plus", "least", "minimum", "similar",
  "related", "relevant", "level", "background",
]);

/** Meaningful words of a short label: lower case, punctuation dropped (C++, C# and .NET kept), plurals folded. */
export function contentWords(text: string): Set<string> {
  const words = text.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}+#-]+/u)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w && !filler.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return new Set(words);
}

/** Dice overlap of two labels' meaningful words, 0..1. */
export function similarity(a: string, b: string): number {
  const x = contentWords(a), y = contentWords(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return (2 * shared) / (x.size + y.size);
}

/** 1 when every meaningful word of the shorter place name is in the other ("Sofia" in "Sofia, Bulgaria"), else 0. */
function containment(a: string, b: string): number {
  const [x, y] = [contentWords(a), contentWords(b)].sort((p, q) => p.size - q.size);
  return x!.size > 0 && [...x!].every((w) => y!.has(w)) ? 1 : 0;
}

const sameLabel = (e: Item, x: Item) => (e.label === x.label ? 1 : 0);

/** Two requirement labels name the same ask when at least half their meaningful words are shared (Dice). */
export const TEXT_MATCH = 0.5;

interface Item { label: string; kind?: string }

/** Greedy one-to-one matching: the most similar pairs first, each side used once. */
function matchLists(expected: Item[], extracted: Item[], score: (e: Item, x: Item) => number, threshold: number, withKind = true): ListScore {
  const pairs: { e: number; x: number; s: number }[] = [];
  expected.forEach((e, ei) => extracted.forEach((x, xi) => {
    const s = score(e, x);
    if (s >= threshold) pairs.push({ e: ei, x: xi, s });
  }));
  pairs.sort((p, q) => q.s - p.s || p.e - q.e || p.x - q.x);
  const usedE = new Set<number>(), usedX = new Set<number>();
  let kindAgreed = 0;
  for (const p of pairs) {
    if (usedE.has(p.e) || usedX.has(p.x)) continue;
    usedE.add(p.e); usedX.add(p.x);
    if (expected[p.e]!.kind === extracted[p.x]!.kind) kindAgreed++;
  }
  return {
    expected: expected.length,
    extracted: extracted.length,
    matched: usedE.size,
    kindAgreed: withKind ? kindAgreed : null,
    missed: expected.filter((_, i) => !usedE.has(i)).map((e) => e.label),
    extra: extracted.filter((_, i) => !usedX.has(i)).map((x) => x.label),
  };
}

export function scoreCase(expected: ExpectedFacts, facts: PostingFacts): CaseScore {
  const byText = (e: Item, x: Item) => similarity(e.label, x.label);
  return {
    requirements: matchLists(
      expected.requirements.map((r) => ({ label: r.text, kind: r.kind })),
      facts.requirements.map((r) => ({ label: r.text, kind: r.kind })),
      byText, TEXT_MATCH,
    ),
    years: matchLists(expected.years.map(yearsItem), facts.years.map(yearsItem), sameLabel, 1),
    languages: matchLists(
      expected.languages.map((l) => ({ label: l.language, kind: l.kind })),
      facts.languages.map((l) => ({ label: l.language, kind: l.kind })),
      (e, x) => sameLabel({ label: e.label.toLowerCase().trim() }, { label: x.label.toLowerCase().trim() }), 1,
    ),
    certificates: matchLists(
      expected.certificates.map((c) => ({ label: c.name, kind: c.kind })),
      facts.certificates.map((c) => ({ label: c.name, kind: c.kind })),
      byText, TEXT_MATCH,
    ),
    locations: matchLists(
      expected.remote.locations.map((label) => ({ label })),
      facts.remote.locations.map((label) => ({ label })),
      (e, x) => containment(e.label, x.label), 1, false,
    ),
    remote: expected.remote.mode === facts.remote.mode,
    workAuthorisation: expected.visaSponsorship === facts.workAuthorisation.visaSponsorship,
    salary: salaryKey(expected.salary) === salaryKey(facts.salary),
    language: expected.language.trim().toLowerCase() === facts.language.trim().toLowerCase(),
  };
}

type SalaryLike = { stated?: boolean; min: number | null; max: number | null; currency: string | null; period: string | null; basis: string };

/**
 * A salary as one comparable string; "none" when pay isn't stated (or no amount is given). A max
 * equal to the min means one amount, the same as a min with no max.
 */
function salaryKey(s: SalaryLike | null): string {
  if (!s || s.stated === false || (s.min == null && s.max == null)) return "none";
  const max = s.max === s.min ? null : s.max;
  return [s.min, max, s.currency?.trim().toUpperCase() ?? null, s.period, s.basis].join("|");
}

/** "3+ years", "2–4 years": the numbers are the identity; a max equal to the min means the same as none. */
function yearsItem(y: { min: number; max: number | null; kind: string }): Item {
  const open = y.max == null || y.max === y.min;
  return { label: open ? `${y.min}+ years` : `${y.min}–${y.max} years`, kind: y.kind };
}
