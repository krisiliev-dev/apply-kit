// Reads a PDF's text the way a parser does, with pdf.js, on this laptop: pages of lines in the order
// the text is stored (the tagged reading order). Used by the ATS check and to count pages.
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { PdfText, PdfTextReader } from "@apply-kit/core";

/** Joins text runs into lines: a run lower on the page starts a line; a gap between runs on one line is a space. */
function linesOf(items: TextItem[]): string[] {
  const lines: string[] = [];
  let line = "";
  let y: number | null = null;
  let end = 0;
  for (const item of items) {
    const [, , , , x, iy] = item.transform as [number, number, number, number, number, number];
    if (item.str !== "") {
      if (y !== null && Math.abs(iy - y) > Math.max(item.height, 1) / 2) {
        lines.push(line);
        line = "";
      } else if (line !== "" && x - end > 1 && !line.endsWith(" ") && !item.str.startsWith(" ")) {
        line += " ";
      }
      line += item.str;
      y = iy;
      end = x + item.width;
    }
  }
  if (line !== "") lines.push(line);
  return lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export async function readPdfText(pdf: Uint8Array): Promise<PdfText> {
  // Load native PDF/font support only for PDF work; it can stall service startup on macOS.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js takes ownership of the buffer it's given, so it gets a copy.
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false });
  try {
    const doc = await task.promise;
    const pages: PdfText["pages"] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push({ lines: linesOf(content.items.filter((i): i is TextItem => "str" in i)) });
    }
    return { pages };
  } finally {
    await task.destroy();
  }
}

export function createPdfJsReader(): PdfTextReader {
  return { read: readPdfText };
}
