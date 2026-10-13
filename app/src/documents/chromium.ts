// Prints documents with headless Chromium through Playwright (ADR 0003): A4 from the template's CSS
// page size, fonts embedded, a tagged PDF carrying the page's language and title. One browser is
// started on first use and kept for later renders.
import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import type { DocumentRenderer } from "@apply-kit/core";
import { documentHtml } from "./template.ts";
import { readPdfText } from "./pdf-text.ts";

/** Whether Playwright's Chromium is installed (`pnpm exec playwright install chromium-headless-shell`). */
export function chromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

export interface ChromiumRenderer extends DocumentRenderer {
  close(): Promise<void>;
}

export function createChromiumRenderer(): ChromiumRenderer {
  let browser: Promise<Browser> | null = null;
  const open = () => (browser ??= chromium.launch());
  return {
    async render(doc) {
      const page = await (await open()).newPage();
      try {
        await page.setContent(documentHtml(doc), { waitUntil: "load" });
        await page.evaluate("document.fonts.ready.then(() => true)");
        const pdf = new Uint8Array(await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true }));
        // The page count comes from the PDF itself, so a spill onto page 2 shows.
        const pages = (await readPdfText(pdf)).pages.length;
        return { pdf, pages };
      } finally {
        await page.close();
      }
    },
    async close() {
      if (browser) await (await browser).close();
      browser = null;
    },
  };
}
