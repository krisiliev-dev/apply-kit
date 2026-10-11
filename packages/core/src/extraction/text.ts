// Posting HTML → plain text for the extractor, and locating a quoted line in that text.

const blockEnd = /<\/(p|div|li|h[1-6]|tr|ul|ol|section|article|header|footer|blockquote|pre|table)\s*>/gi;

const named: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»", bull: "•",
  middot: "·", euro: "€", pound: "£", copy: "©", reg: "®", trade: "™", times: "×", deg: "°",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return named[k] ?? whole;
  });
}

/**
 * One line per paragraph, heading or list item (list items get a "• " prefix), entities decoded,
 * runs of spaces collapsed, empty lines dropped. Script and style contents are removed.
 */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(blockEnd, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(withBreaks)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l !== "" && l !== "•")
    .join("\n");
}

const norm = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/[‘’'`´]/g, "'").replace(/[“”„"«»]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

/**
 * The 1-based line of `text` that contains `quote` (compared case-, quote-mark- and
 * space-insensitively), or null if the quote isn't in the posting. A quote that spans
 * lines is found by its start.
 */
export function lineOf(text: string, quote: string): number | null {
  const needle = norm(quote).replace(/^["'•\s]+|["'\s]+$/g, "");
  if (needle.length === 0) return null;
  const lines = text.split("\n").map(norm);
  const i = lines.findIndex((l) => l.includes(needle));
  if (i >= 0) return i + 1;
  // Spanning lines: match the joined text, then map the offset back to a line.
  const joined = lines.join(" ");
  const at = joined.indexOf(needle);
  if (at < 0) return null;
  let offset = 0;
  for (let n = 0; n < lines.length; n++) {
    offset += lines[n]!.length + 1;
    if (at < offset) return n + 1;
  }
  return null;
}
