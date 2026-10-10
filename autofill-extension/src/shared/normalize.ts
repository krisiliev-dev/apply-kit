// Pure text helpers. No DOM, no chrome.* — safe to import anywhere.

export function normalizeQuestion(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\p{L}\p{N}\s?'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(raw: string): string[] {
  return normalizeQuestion(raw)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Tiny stopword list — enough to stop "your"/"the"/"and" from dominating Jaccard.
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "your",
  "you",
  "yours",
  "my",
  "me",
  "we",
  "our",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "with",
  "from",
  "by",
  "as",
  "if",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "please",
  "kindly",
  "about",
  "tell",
  "us",
]);

export function jaccard(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
