// Near-duplicates across imported files: the same role, achievement or skill written slightly
// differently in two CV versions (or the CV and LinkedIn) is one piece, checked once, citing both.
import { quantities } from "./numbers.ts";
import type { PieceEntry, PieceKind } from "./profile.ts";

export interface DraftPiece {
  kind: PieceKind;
  text: string;
  entry: PieceEntry | null;
}

const stopWords = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "by", "with", "at", "from", "into", "through", "via",
  "about", "around", "roughly", "my", "our", "its", "their", "as", "that", "which", "who", "was", "were", "is", "are",
]);

const words = (s: string) =>
  new Set(
    s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w && !stopWords.has(w))
      .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
  );

function overlap(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

const same = (a: string, b: string) => [...words(a)].sort().join(" ") === [...words(b)].sort().join(" ");

/** The numbers a text claims, so "a third" and "half" never merge. */
const numbersOf = (s: string) => quantities(s).map((q) => `${q.kind}:${q.value.toFixed(3)}`).sort().join(",");

/** An achievement worded this alike, with the same numbers, is the same achievement. */
const ACHIEVEMENT_OVERLAP = 0.6;

export function isNearDuplicate(a: DraftPiece, b: DraftPiece): boolean {
  if (a.kind !== b.kind) return false;
  if (a.entry || b.entry) {
    if (!a.entry || !b.entry) return false;
    // The same employer (or school) and a title that reads alike, or the same start year.
    return same(a.entry.organisation, b.entry.organisation)
      && (overlap(a.entry.title, b.entry.title) >= 0.5 || (a.entry.start.slice(0, 4) !== "" && a.entry.start.slice(0, 4) === b.entry.start.slice(0, 4)));
  }
  if (a.kind === "skill") return same(a.text, b.text);
  return numbersOf(a.text) === numbersOf(b.text) && overlap(a.text, b.text) >= ACHIEVEMENT_OVERLAP;
}
