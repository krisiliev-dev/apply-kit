import { describe, expect, it } from "vitest";
import { draftedPiecesSchema, type DraftedPieces, type ImportInput, type ImportedText } from "../src/index.ts";
import { fixtureFetch, loadFixture } from "./harness.ts";
import { createTestPreparation, fakePdf, fakeRecognizer, fakeWriter, scannedPdf, type TestPreparationOptions } from "./preparation-harness.ts";
import { docx, zip } from "./zip.ts";

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

describe("near-duplicates across files", () => {
  it("gives one piece citing both CV versions when they state the same achievement", async () => {
    const t = await imported({ files: [cv2025, cv2023] });

    const achievements = t.preparation.listPieces({ kind: "achievement" }).groups.flatMap((g) => g.pieces);
    const falsePositives = achievements.filter((p) => /false positives/.test(p.text));
    expect(falsePositives).toHaveLength(1);
    expect(falsePositives[0]).toMatchObject({
      text: "Cut false positives by about a third by tuning Splunk detection rules.",
      source: { from: "CV-2025.pdf", quote: "Cut false positives by about a third by tuning Splunk detection rules." },
      alsoFrom: [{ from: "CV-2023.docx", quote: "Reduced false positives by about a third through Splunk rule tuning" }],
    });
    // The 2023 CV's new achievement sits under the role both CVs share.
    const role = t.preparation.listPieces({ kind: "role" }).groups.flatMap((g) => g.pieces);
    expect(role).toHaveLength(1);
    expect(achievements.find((p) => p.text.startsWith("Trained 12"))?.belongsTo).toBe(role[0]!.id);
    expect(t.status.items.map((i) => [i.name, i.pieces, i.merged])).toEqual([["CV-2025.pdf", 5, 0], ["CV-2023.docx", 1, 3]]);
  });

  it("lists every merge with both wordings, for See merges", async () => {
    const t = await imported({ files: [cv2025, cv2023] });

    expect(t.preparation.importMerges(t.id)).toEqual([
      {
        pieceId: expect.any(String),
        piece: "Security Analyst, Northwind Bank",
        kept: { from: "CV-2025.pdf", quote: "Security Analyst, Northwind Bank, Sofia, Mar 2022 – present" },
        merged: { from: "CV-2023.docx", quote: "Northwind Bank, Security Analyst (Mar 2022 – now)", text: "Security Analyst, Northwind Bank" },
      },
      {
        pieceId: expect.any(String),
        piece: "Cut false positives by about a third by tuning Splunk detection rules.",
        kept: { from: "CV-2025.pdf", quote: "Cut false positives by about a third by tuning Splunk detection rules." },
        merged: { from: "CV-2023.docx", quote: "Reduced false positives by about a third through Splunk rule tuning", text: "Reduced false positives by about a third through Splunk rule tuning." },
      },
      {
        pieceId: expect.any(String),
        piece: "Splunk",
        kept: { from: "CV-2025.pdf", quote: "Splunk, Python, incident response" },
        merged: { from: "CV-2023.docx", quote: "Skills: Splunk, Python", text: "Splunk" },
      },
    ]);
  });

  it("keeps achievements with different numbers apart, however alike their words", async () => {
    const half: DraftedPieces = { pieces: [{ kind: "achievement", text: "Cut false positives by half by tuning Splunk detection rules.", quote: "Cut false positives by half by tuning Splunk detection rules.", entry: null, role: null }] };
    const writer = fakeWriter({ draftPieces: (input: ImportedText) => (input.fileName === "old.txt" ? half : mira2025) });
    const old = { fileName: "old.txt", bytes: new TextEncoder().encode("Cut false positives by half by tuning Splunk detection rules.") };

    const t = await imported({ files: [cv2025, old] }, { writer });

    expect(t.preparation.listPieces({ kind: "achievement", search: "false positives" }).groups.flatMap((g) => g.pieces)).toHaveLength(2);
  });
});

describe("files that can't be read", () => {
  const scan = { fileName: "CV_old_2021.pdf", bytes: scannedPdf };

  it("reports a scanned PDF with its three ways forward, and reads the other files", async () => {
    const writer = miraWriter();
    const t = await imported({ files: [cv2025, scan, cv2023] }, { writer, recognizer: fakeRecognizer([]) });

    expect(t.status.items.map((i) => [i.name, i.state])).toEqual([["CV-2025.pdf", "done"], ["CV_old_2021.pdf", "unreadable"], ["CV-2023.docx", "done"]]);
    expect(t.status.items[1]!.problem).toEqual({
      reason: "scanned",
      message: "It's a scanned image: the pages are pictures, so there's no text to read.",
      options: ["recognise", "text-version", "skip"],
    });
    expect(t.status).toMatchObject({ state: "finished", done: 2, total: 3 });
    expect(writer.calls.map((c) => c.input.fileName)).toEqual(["CV-2025.pdf", "CV-2023.docx"]);
  });

  it("reads a scan with text recognition on request, marking its pieces check this", async () => {
    const lines = ["Junior Analyst, Northwind Bank, 2021", "Triaged phishing reports for the SOC."];
    const recognizer = fakeRecognizer(lines);
    const recognised: DraftedPieces = { pieces: [{ kind: "achievement", text: "Triaged phishing reports for the SOC.", quote: "Triaged phishing reports for the SOC.", entry: null, role: null }] };
    const writer = fakeWriter({ draftPieces: recognised });
    const t = await imported({ files: [scan] }, { writer, recognizer });

    const resolved = await t.preparation.resolveUnreadable(t.status.items[0]!.id, { action: "recognise" });
    if (!resolved.resolved) throw new Error(resolved.message);
    const after = await resolved.done;

    expect(after.items[0]).toMatchObject({ state: "done", recognised: true, pieces: 1 });
    expect(writer.calls).toEqual([{ task: "draft-pieces", input: { fileName: "CV_old_2021.pdf", text: lines.join("\n") } }]);
    expect(t.preparation.listPieces().groups[0]!.pieces[0]).toMatchObject({ text: "Triaged phishing reports for the SOC.", status: "unconfirmed", checkThis: true });
  });

  it("reads a text version uploaded in place of the scan, or skips it", async () => {
    const t = await imported({ files: [scan, { fileName: "notes.pages", bytes: new Uint8Array([80, 75, 3, 4]) }] }, { recognizer: fakeRecognizer([]) });
    const [scanItem, pagesItem] = t.status.items;
    expect(pagesItem!.problem).toMatchObject({ reason: "pages", options: ["text-version", "skip"] });

    const replaced = await t.preparation.resolveUnreadable(scanItem!.id, { action: "text-version", file: cv2025 });
    if (!replaced.resolved) throw new Error(replaced.message);
    await replaced.done;
    const skipped = await t.preparation.resolveUnreadable(pagesItem!.id, { action: "skip" });
    if (!skipped.resolved) throw new Error(skipped.message);

    expect((await skipped.done).items.map((i) => [i.name, i.state, i.pieces])).toEqual([["CV-2025.pdf", "done", 5], ["notes.pages", "skipped", 0]]);
    // The scan's copy is gone; the text version's is kept.
    expect(await t.files.get(scanItem!.sha256!)).toBeNull();
  });

  it("doesn't offer text recognition where it can't run", async () => {
    const t = await imported({ files: [scan] });

    expect(t.status.items[0]!.problem?.options).toEqual(["text-version", "skip"]);
  });
});

describe("cancelling an import", () => {
  it("keeps the pieces already drafted and reads nothing more", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const writer = fakeWriter({
      draftPieces: async (input: ImportedText) => {
        if (input.fileName === "CV-2023.docx") await held;
        return input.fileName === "CV-2023.docx" ? mira2023 : mira2025;
      },
    });
    const t = createTestPreparation({ writer });
    const third = { fileName: "cover.txt", bytes: new TextEncoder().encode("Dear team") };
    const run = await t.preparation.startImport({ files: [cv2025, cv2023, third] });
    if (!run.started) throw new Error("not started");
    while (writer.calls.length < 2) await new Promise((r) => setImmediate(r));

    const cancelled = t.preparation.cancelImport(run.status.id);
    release();
    const final = await run.done;

    expect(cancelled?.pieces).toBe(5);
    expect(final.state).toBe("cancelled");
    expect(final.items.map((i) => [i.name, i.state])).toEqual([["CV-2025.pdf", "done"], ["CV-2023.docx", "cancelled"], ["cover.txt", "cancelled"]]);
    expect(t.preparation.listPieces().total).toBe(5);
    expect(writer.calls).toHaveLength(2);
  });
});

describe("the monthly AI budget during import", () => {
  it("leaves a file that would cross the cap waiting, keeps what finished, and reads it once the month turns", async () => {
    const writer = miraWriter({ costUsd: 0.006 });
    const linkedIn = { fileName: "Basic_LinkedInDataExport.zip", bytes: zip({ "Skills.csv": "Name\nThreat hunting\n" }) };
    const t = await imported({ files: [cv2025, cv2023], linkedIn }, { writer, capUsd: 0.01 });

    expect(t.status.items.map((i) => [i.name, i.state, i.waitingFor])).toEqual([
      ["CV-2025.pdf", "done", null],
      ["CV-2023.docx", "waiting", "budget"],
      ["Basic_LinkedInDataExport.zip", "done", null],
    ]);
    expect(t.status).toMatchObject({ pieces: 6, waitingCostUsd: 0.006, budget: { reached: true } });
    expect(writer.calls).toHaveLength(1);

    t.clock.set("2026-11-01T07:00:00Z");
    const resumed = t.preparation.resumeImport(t.id)!;
    const after = await resumed.done;

    expect(after.items[1]).toMatchObject({ state: "done", pieces: 1, merged: 3 });
  });
});

describe("the LinkedIn export and GitHub, read without the model", () => {
  const positions = [
    "Company Name,Title,Description,Location,Started On,Finished On",
    'Northwind Bank,Security Analyst,"Monitoring, triage and detections",\"Sofia, Bulgaria\",Mar 2022,',
    "Contoso Labs,IT Support Intern,,Plovdiv,Jun 2020,Sep 2021",
  ].join("\n");
  const linkedIn = {
    fileName: "Basic_LinkedInDataExport_10-13-2026.zip",
    bytes: zip({
      "Positions.csv": positions,
      "Education.csv": "School Name,Start Date,End Date,Notes,Degree Name,Activities\nTechnical University of Sofia,2016,2020,,BSc Computer Systems,\n",
      "Skills.csv": "Name\nSplunk\nThreat hunting\n",
      "Languages.csv": "Name,Proficiency\nEnglish,Full professional proficiency\n",
    }),
  };

  it("turns positions, education, skills and languages into pieces, merging what a CV already gave", async () => {
    const writer = miraWriter();
    const t = await imported({ files: [cv2025], linkedIn }, { writer });

    const pieces = t.preparation.listPieces().groups.flatMap((g) => g.pieces);
    expect(pieces.filter((p) => p.source.from === linkedIn.fileName).map((p) => [p.kind, p.entry ?? p.text])).toEqual([
      ["role", { title: "IT Support Intern", organisation: "Contoso Labs", city: "Plovdiv", start: "2020-06", end: "2021-09" }],
      ["education", { title: "BSc Computer Systems", organisation: "Technical University of Sofia", city: null, start: "2016", end: "2020" }],
      ["skill", "Threat hunting"],
      ["skill", "English (Full professional proficiency)"],
    ]);
    expect(t.status.items[1]).toMatchObject({ state: "done", pieces: 4, merged: 2, detail: "2 positions · 1 school · 3 skills" });
    expect(writer.calls.map((c) => c.input.fileName)).toEqual(["CV-2025.pdf"]);
  });

  it("drafts a skill per language from public GitHub repositories, leaving forks out", async () => {
    const writer = miraWriter();
    const fetch = fixtureFetch({ "https://api.github.com/users/mira-petrova-example/repos?per_page=100&type=owner&sort=pushed": "github-repos-mira.json" });
    const t = await imported({ github: "https://github.com/mira-petrova-example" }, { writer, fetch });

    expect(t.preparation.listPieces().groups.flatMap((g) => g.pieces).map((p) => [p.text, p.source.quote])).toEqual([
      ["Python", "Python: 2 public repositories (phish-triage, splunk-rules)"],
      ["TypeScript", "TypeScript: 1 public repository (soc-dashboard)"],
    ]);
    expect(t.status.items[0]).toMatchObject({ name: "github.com/mira-petrova-example", state: "done", detail: "4 public repositories" });
    expect(writer.calls).toEqual([]);
  });

  it("says when a link can't be reached, with a way to try again", async () => {
    const offline: typeof globalThis.fetch = async () => { throw new Error("getaddrinfo ENOTFOUND api.github.com"); };
    const t = await imported({ github: "github.com/mira-petrova-example" }, { fetch: offline });

    expect(t.status.items[0]).toMatchObject({ state: "unreadable", problem: { reason: "unreachable", options: ["retry", "skip"] } });
  });
});

describe("what Kris gives to import", () => {
  it("asks for at least one source, and for links it can read", async () => {
    const t = createTestPreparation();

    expect(await t.preparation.startImport({})).toEqual({ started: false, problems: [{ field: "files", message: "Add at least one file or link to import." }] });
    expect(await t.preparation.startImport({ github: "mira on github", portfolio: "not a site", linkedIn: { fileName: "export.csv", bytes: new Uint8Array([1]) } })).toMatchObject({
      started: false,
      problems: [{ field: "linkedIn" }, { field: "github" }, { field: "portfolio" }],
    });
  });
});

describe("checking drafted pieces", () => {
  it("confirms a drafted piece once it has what a confirmed piece needs", async () => {
    const t = await imported({ files: [cv2025] });
    const pieces = t.preparation.listPieces().groups.flatMap((g) => g.pieces);
    const cut = pieces.find((p) => p.text.startsWith("Cut false positives"))!;
    const runbook = pieces.find((p) => p.text.startsWith("Wrote the phishing runbook"))!;

    const refused = t.preparation.confirmPiece(cut.id);
    const confirmed = t.preparation.confirmPiece(runbook.id);

    expect(refused).toEqual({ saved: false, problems: [{ field: "numberSource", message: "This piece has a number, so pick where it comes from.", fixes: [] }] });
    expect(confirmed).toMatchObject({ saved: true, piece: { status: "confirmed", source: { from: "CV-2025.pdf" } } });
    expect(t.preparation.profileSummary()).toMatchObject({ confirmed: 1, needsYou: { masterProfile: 4 } });
  });

  it("leaves out a drafted piece whose quote isn't in the file, or whose number its quote doesn't give", async () => {
    const invented: DraftedPieces = { pieces: [
      { kind: "skill", text: "Kubernetes", quote: "Kubernetes", entry: null, role: null },
      { kind: "achievement", text: "Cut false positives by 60%.", quote: "Cut false positives by about a third by tuning Splunk detection rules.", entry: null, role: null },
      { kind: "skill", text: "Splunk", quote: "Splunk, Python, incident response", entry: null, role: null },
    ] };
    const t = await imported({ files: [cv2025] }, { writer: fakeWriter({ draftPieces: invented }) });

    expect(t.preparation.listPieces().groups.flatMap((g) => g.pieces).map((p) => p.text)).toEqual(["Splunk"]);
  });
});
