// A small, dependency-free reading of alert-email HTML: the email as a flat run of links and text
// lines in document order. Alert emails are table soup; their job cards are always "a link to the
// job, then a few short lines about it", which is all the parsers need.

export type Piece = { kind: "link"; href: string; text: string } | { kind: "line"; text: string };

const blockTags = new Set([
  "p", "div", "br", "tr", "td", "th", "li", "ul", "ol", "table", "tbody", "thead", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "section", "center",
]);

export function readEmailHtml(html: string): Piece[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, "");
  const pieces: Piece[] = [];
  let line = "";
  let link: { href: string; text: string } | null = null;
  const flushLine = () => {
    const text = clean(line);
    if (text) pieces.push({ kind: "line", text });
    line = "";
  };
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  for (const m of body.matchAll(tag)) {
    const [, closing, rawName, attrs, text] = m;
    if (text !== undefined) {
      if (link) link.text += text;
      else line += text;
      continue;
    }
    const name = rawName!.toLowerCase();
    if (name === "a") {
      if (!closing) {
        flushLine();
        const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs!);
        link = { href: decodeEntities(href?.[2] ?? href?.[3] ?? "").trim(), text: "" };
      } else if (link) {
        pieces.push({ kind: "link", href: link.href, text: clean(link.text) });
        link = null;
      }
    } else if (blockTags.has(name)) {
      if (link) link.text += " ";
      else flushLine();
    }
  }
  if (link) pieces.push({ kind: "link", href: link.href, text: clean(link.text) });
  flushLine();
  return pieces;
}

function clean(s: string): string {
  return decodeEntities(s).replace(/\u034f|\u200b|\u200c/g, "").replace(/[\s\u00a0]+/g, " ").trim();
}

const named: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", euro: "€", pound: "£",
  copy: "©", ndash: "–", mdash: "—", bull: "•", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bdquo: "„", zwnj: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return named[e.toLowerCase()] ?? whole;
  });
}

/**
 * A tracking redirect (click.example.com/?url=https%3A...) unwrapped to the link it points at;
 * any other link is returned as is.
 */
export function unwrapRedirect(href: string): string {
  let url: URL;
  try { url = new URL(href); } catch { return href; }
  for (const value of url.searchParams.values()) {
    if (/^https?:\/\//i.test(value)) return unwrapRedirect(value);
  }
  return href;
}
