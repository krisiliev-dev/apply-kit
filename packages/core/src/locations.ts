// Which postings count as "in your locations" for source health: Sofia, or remote within Europe.
// A deliberately small starting rule with whole-token matching (never substrings: "uk" must not
// match "Ukraine") and Cyrillic support. Fit and ranking (#12) and the search settings replace it
// with Kris's own location groups.

const sofia = new Set(["sofia", "софия", "sofiya"]);
const remote = new Set(["remote", "дистанционно", "anywhere"]);
const europe = new Set(["europe", "eu", "emea", "eea", "cet", "eet", "bulgaria", "българия", "european"]);

function tokens(text: string): string[] {
  return text.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function isInYourLocations(location: string | null): boolean {
  if (!location) return false;
  const t = tokens(location);
  if (t.some((w) => sofia.has(w))) return true;
  return t.some((w) => remote.has(w)) && t.some((w) => europe.has(w));
}
