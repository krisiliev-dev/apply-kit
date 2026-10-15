import { describe, expect, it } from "vitest";
import { createTestPreparation, fakePdf, scannedPdf, type TestPreparationOptions } from "./preparation-harness.ts";
import { docx } from "./zip.ts";

// Voice (ticket #59): samples of Kris's own writing, the voice rules learned from them and from
// edits to drafts, and the voice context each draft sends. Through the preparation engine with the
// fake writer's recorded outputs; no live AI. Every sample is invented, by made-up people.

const text = (s: string) => new TextEncoder().encode(s);

/** A made-up cover letter by a made-up person (Mira Petrova), 3 short paragraphs. */
const orbitalLetter = [
  "Dear Orbital Freight team,",
  "Your night shift loses an hour every time a parcel scan fails. I fixed the same problem at Northwind Bank, where alerts failed quietly for weeks.",
  "I wrote the runbook the analysts still use. It is short. Every step names who acts and what they check.",
  "Kind regards,\nMira Petrova",
].join("\n\n");

const aboutPage = "I build small tools that make noisy systems quieter. Most of my work is reading logs nobody reads and deciding what matters.";

export async function withSamples(options: TestPreparationOptions = {}) {
  const t = createTestPreparation(options);
  const added = await t.preparation.addVoiceSamples([
    { fileName: "cover-letter-orbital-2023.docx", bytes: docx(orbitalLetter.split("\n\n")) },
    { fileName: "about-page.txt", bytes: text(aboutPage) },
  ]);
  return { ...t, added };
}

describe("voice samples", () => {
  it("lists each sample with its kind and length, and an unreadable one with the reason and how to fix it while the others still count", async () => {
    const t = createTestPreparation();

    await t.preparation.addVoiceSamples([
      { fileName: "cover-letter-orbital-2023.docx", bytes: docx(orbitalLetter.split("\n\n")) },
      { fileName: "about-page.txt", bytes: text(aboutPage) },
      { fileName: "cover-letter-2022.pages", bytes: text("PK\u0003\u0004 not really a pages file") },
      { fileName: "scan.pdf", bytes: scannedPdf },
      { fileName: "letter-varna.pdf", bytes: fakePdf([["Dear Varna Telecom team,", "Your outage reports arrive a day late."]]) },
    ]);

    expect(t.preparation.voice().samples.map((s) => [s.fileName, s.kind, s.words, s.language, s.problem?.message ?? null])).toEqual([
      ["cover-letter-orbital-2023.docx", "cover-letter", 54, "en", null],
      ["about-page.txt", "writing", 22, "en", null],
      ["cover-letter-2022.pages", "cover-letter", 0, null, "Couldn't read a .pages file. Export it as PDF or DOCX from Pages; the other samples still count."],
      ["scan.pdf", "writing", 0, null, "This PDF is a scan, with no text to read. Export it again with its text, or as DOCX or TXT; the other samples still count."],
      ["letter-varna.pdf", "cover-letter", 11, "en", null],
    ]);
  });
});
