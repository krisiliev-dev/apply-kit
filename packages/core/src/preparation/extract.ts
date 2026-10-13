// Text from the files Kris imports, on this laptop: PDF through the PDF text reader (pdf.js), DOCX
// from the document XML inside the zip, plain text as is. Only this text ever reaches the model.
import type { PdfText } from "./ports.ts";
import { readZip, ZipError } from "./zip.ts";

export type ImportFileType = "pdf" | "docx" | "txt" | "pages" | "doc" | "zip" | "link" | "other";

/** What a file is, by its name and, where the name is unclear, by its first bytes. */
export function fileTypeOf(fileName: string, bytes: Uint8Array): ImportFileType {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (ext === "pdf" || ext === "docx" || ext === "txt" || ext === "pages" || ext === "doc" || ext === "zip") return ext;
  if (ext === "md" || ext === "text") return "txt";
  const head = new TextDecoder().decode(bytes.subarray(0, 5));
  if (head === "%PDF-") return "pdf";
  return "other";
}

/** A PDF's text layer as lines, page after page. Empty when it has none (a scan). */
export function pdfPlainText(text: PdfText): string {
  return text.pages.flatMap((p) => p.lines).map((l) => l.trim()).filter(Boolean).join("\n");
}

export function plainText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "").replace(/\r\n?/g, "\n")
    .split("\n").map((l) => l.trimEnd()).join("\n").trim();
}

/** A Word document's paragraphs, one per line (tabs and line breaks kept). Throws ZipError when it's damaged. */
export function docxText(bytes: Uint8Array): string {
  const xml = readZip(bytes).get("word/document.xml");
  if (!xml) throw new ZipError("no document inside");
  const doc = new TextDecoder().decode(xml);
  const paragraphs = doc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  return paragraphs
    .map((p) => {
      let line = "";
      for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g)) {
        line += m[1] !== undefined ? decodeXml(m[1]) : m[0].startsWith("<w:tab") ? "\t" : "\n";
      }
      return line.trim();
    })
    .filter(Boolean)
    .join("\n");
}

function decodeXml(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    const named: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
    if (named[e.toLowerCase()]) return named[e.toLowerCase()]!;
    return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

/** For comparing a quote with its source: case, spacing, dashes, quote marks and bullets don't count. */
export function normaliseForQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/^[\s•▪◦·*-]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether the quote is in the text, word for word (allowing the differences above and a dropped full stop). */
export function quoteIsIn(quote: string, text: string): boolean {
  const q = normaliseForQuote(quote).replace(/[.;,]$/, "");
  return q.length > 0 && normaliseForQuote(text).includes(q);
}
