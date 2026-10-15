// Text recognition for scanned PDFs (import, ticket #54): macOS's own Vision framework, run through
// recognise.swift with the Swift that ships with the Command Line Tools. Runs on this laptop only; the
// scan never leaves it. Throws a plain-words error when it can't run here.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PdfText, TextRecognizer } from "@apply-kit/core";

const script = fileURLToPath(new URL("./recognise.swift", import.meta.url));
/** Compiling the script and reading a few pages takes about a minute at most. */
const TIMEOUT_MS = 180_000;

export function createVisionRecognizer(): TextRecognizer {
  return {
    async recognise(pdf) {
      const dir = await mkdtemp(join(tmpdir(), "apply-kit-ocr-"));
      try {
        const file = join(dir, "scan.pdf");
        await writeFile(file, pdf);
        const out = await new Promise<string>((resolve, reject) => {
          execFile("swift", [script, file], { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (!err) return resolve(stdout);
            const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
            reject(new Error(missing
              ? "Text recognition needs Apple's Command Line Tools (run xcode-select --install)"
              : `Text recognition failed: ${stderr.trim().split("\n").pop() || err.message}`));
          });
        });
        return JSON.parse(out) as PdfText;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
