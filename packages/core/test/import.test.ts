import { describe, expect, it } from "vitest";
import { draftedPiecesSchema, type DraftedPieces, type ImportInput, type ImportedText } from "../src/index.ts";
import { loadFixture } from "./harness.ts";
import { createTestPreparation, fakePdf, fakeWriter, type TestPreparationOptions } from "./preparation-harness.ts";
import { docx } from "./zip.ts";

// Import (ticket #54): old CVs, the LinkedIn export and GitHub into drafted profile pieces, through
// the preparation engine with the fake writer's recorded outputs. Made-up person only: Mira Petrova.

const recorded = (name: string): DraftedPieces => draftedPiecesSchema.parse(JSON.parse(loadFixture(name)));
const mira2025 = recorded("writer-draft-pieces-mira-2025.json");
const mira2023 = recorded("writer-draft-pieces-mira-2023.json");

/** The 2025 CV's text layer, one page. */
const cv2025Lines = [
  "Mira Petrova",
  "Sofia · mira.petrova@example.com",
  "Experience",
  "Security Analyst, Northwind Bank, Sofia, Mar 2022 – present",
  "Cut false positives by about a third by tuning Splunk detection rules.",
  "Wrote the phishing runbook the SOC uses for every reported email.",
  "Skills",
  "Splunk, Python, incident response",
];
/** The 2023 CV's paragraphs, as Word keeps them. */
const cv2023Paragraphs = [
  "Mira Petrova — CV",
  "Northwind Bank, Security Analyst (Mar 2022 – now)",
  "Reduced false positives by about a third through Splunk rule tuning",
  "Trained 12 new analysts on alert triage",
  "Skills: Splunk, Python",
];

const cv2025 = { fileName: "CV-2025.pdf", bytes: fakePdf([cv2025Lines]) };
const cv2023 = { fileName: "CV-2023.docx", bytes: docx(cv2023Paragraphs) };

/** The writer answers each CV with what was recorded for it. */
const miraWriter = (options?: Parameters<typeof fakeWriter>[1]) =>
  fakeWriter({ draftPieces: (input: ImportedText) => (input.fileName === "CV-2023.docx" ? mira2023 : mira2025) }, options);

async function imported(input: ImportInput, options: TestPreparationOptions = {}) {
  const t = createTestPreparation({ writer: miraWriter(), ...options });
  const run = await t.preparation.startImport(input);
  if (!run.started) throw new Error(run.problems[0]!.message);
  return { ...t, status: await run.done, id: run.status.id };
}

describe("importing old CVs", () => {
  it("drafts pieces from a CV as unconfirmed, each with the quote it came from, under its role", async () => {
    const t = await imported({ files: [cv2025] });

    const list = t.preparation.listPieces();
    expect(list.groups.map((g) => ({ label: g.label, pieces: g.pieces.map((p) => [p.kind, p.text || p.entry?.title, p.status, p.source]) }))).toEqual([
      {
        label: "Security Analyst · Northwind Bank, Sofia · Mar 2022 – present",
        pieces: [
          ["role", "Security Analyst", "unconfirmed", { from: "CV-2025.pdf", quote: "Security Analyst, Northwind Bank, Sofia, Mar 2022 – present" }],
          ["achievement", "Cut false positives by about a third by tuning Splunk detection rules.", "unconfirmed", { from: "CV-2025.pdf", quote: "Cut false positives by about a third by tuning Splunk detection rules." }],
          ["achievement", "Wrote the phishing runbook the SOC uses for every reported email.", "unconfirmed", { from: "CV-2025.pdf", quote: "Wrote the phishing runbook the SOC uses for every reported email." }],
        ],
      },
      {
        label: "Skills and languages not tied to a role",
        pieces: [
          ["skill", "Splunk", "unconfirmed", { from: "CV-2025.pdf", quote: "Splunk, Python, incident response" }],
          ["skill", "Python", "unconfirmed", { from: "CV-2025.pdf", quote: "Splunk, Python, incident response" }],
        ],
      },
    ]);
    expect(t.status).toMatchObject({ state: "finished", items: [{ name: "CV-2025.pdf", state: "done", pieces: 5, merged: 0 }] });
  });

  it("sends the writer only the text extracted from each file, never the file", async () => {
    const writer = miraWriter();
    const t = await imported({ files: [cv2025, cv2023, { fileName: "cover-letter.txt", bytes: new TextEncoder().encode("Dear team,\nI tune detections.\n") }] }, { writer });

    expect(writer.calls).toEqual([
      { task: "draft-pieces", input: { fileName: "CV-2025.pdf", text: cv2025Lines.join("\n") } },
      { task: "draft-pieces", input: { fileName: "CV-2023.docx", text: cv2023Paragraphs.join("\n") } },
      { task: "draft-pieces", input: { fileName: "cover-letter.txt", text: "Dear team,\nI tune detections." } },
    ]);
    // The originals are kept on this laptop, in the file store.
    expect(await t.files.get(t.status.items[1]!.sha256!)).toEqual(cv2023.bytes);
  });
});
