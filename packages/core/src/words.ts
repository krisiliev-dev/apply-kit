// Whole-word matching that works for Cyrillic as well as Latin text. Never substrings: "uk" must
// not match "Ukraine", "iam" must not match "William". (JS `\b` only knows ASCII word characters,
// so `\bсофия\b` never matches; splitting on Unicode letters and numbers avoids that trap.)

/** Lower-cased words of a text, split on anything that isn't a Unicode letter or number. */
export function words(text: string): string[] {
  return text.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Whether `phrase` (one or more words) occurs in `haystack` as whole consecutive words. */
export function hasPhrase(haystack: readonly string[], phrase: string): boolean {
  const needle = words(phrase);
  if (needle.length === 0) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let k = 0; k < needle.length; k++) if (haystack[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}

/** The phrases from `phrases` that occur in `haystack` as whole words. */
export function phrasesIn(haystack: readonly string[], phrases: readonly string[]): string[] {
  return phrases.filter((p) => hasPhrase(haystack, p));
}
