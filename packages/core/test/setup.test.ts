import { describe, expect, it } from "vitest";
import type { DraftedPieces, ImportedText } from "../src/index.ts";
import { createTestPreparation, fakeWriter, type TestPreparationOptions } from "./preparation-harness.ts";
import { memoryDb } from "./harness.ts";

// Setup around the import (ticket #55): checking drafts, resuming, the search check and the finish,
// through the preparation engine with the fake writer's recorded outputs. Made-up person only: Mira Petrova.

const txt = (fileName: string, lines: string[]) => ({ fileName, bytes: new TextEncoder().encode(lines.join("\n")) });

const role = (quote: string, start = "2023-01") => ({
  kind: "role" as const, text: "", quote,
  entry: { title: "Junior Security Analyst", organisation: "Orbital Bank", city: "Sofia", start, end: null }, role: null,
});
const achievement = (text: string) => ({ kind: "achievement" as const, text, quote: text, entry: null, role: 0 });

/** Two CVs that agree on the role and one achievement, and disagree on who led the phishing response. */
const cv2023Lines = [
  "Junior Security Analyst, Orbital Bank, Sofia, Jan 2023 – now",
  "Took part in the response to 3 phishing incidents.",
  "Wrote the phishing runbook the SOC uses for every reported email.",
];
const cv2025Lines = [
  "Junior Security Analyst, Orbital Bank, Sofia, Jan 2023 – present",
  "Led the response to 3 phishing incidents.",
  "Wrote the phishing runbook the SOC uses for every reported email.",
  "Built a Splunk dashboard for the SOC's morning review.",
];
const drafted: Record<string, DraftedPieces> = {
  "CV-2023.txt": { pieces: [role(cv2023Lines[0]!), achievement(cv2023Lines[1]!), achievement(cv2023Lines[2]!)] },
  "CV-2025.txt": { pieces: [role(cv2025Lines[0]!), achievement(cv2025Lines[1]!), achievement(cv2025Lines[2]!), achievement(cv2025Lines[3]!)] },
};
const writer = () => fakeWriter({ draftPieces: (input: ImportedText) => drafted[input.fileName]! });

async function imported(options: TestPreparationOptions = {}) {
  const t = createTestPreparation({ writer: writer(), ...options });
  const run = await t.preparation.startImport({ files: [txt("CV-2023.txt", cv2023Lines), txt("CV-2025.txt", cv2025Lines)] });
  if (!run.started) throw new Error(run.problems[0]!.message);
  await run.done;
  return t;
}

const texts = (t: Awaited<ReturnType<typeof imported>>, show: Parameters<typeof t.preparation.draftsToCheck>[0]) =>
  t.preparation.draftsToCheck(show).groups.flatMap((g) => g.pieces.map((p) => p.text || p.entry!.title));

describe("checking drafts", () => {
  it("flags a piece whose sources disagree, quoting each source's version", async () => {
    const t = await imported();

    const flagged = t.preparation.draftsToCheck("flagged").groups.flatMap((g) => g.pieces);
    expect(flagged.map((p) => ({ status: p.status, dispute: p.dispute }))).toEqual([{
      status: "flagged",
      dispute: {
        versions: [
          { from: "CV-2023.txt", quote: "Took part in the response to 3 phishing incidents.", text: "Took part in the response to 3 phishing incidents.", entry: null },
          { from: "CV-2025.txt", quote: "Led the response to 3 phishing incidents.", text: "Led the response to 3 phishing incidents.", entry: null },
        ],
        askCoach: false,
      },
    }]);
  });
});

describe("confirming a role's pieces at once", () => {
  it("confirms the unflagged pieces and leaves the flagged one waiting", async () => {
    const t = await imported();
    const orbital = t.preparation.draftsToCheck().groups[0]!;
    expect([orbital.label, orbital.toCheck, orbital.unflagged]).toEqual(["Junior Security Analyst · Orbital Bank, Sofia · Jan 2023 – present", 4, 3]);

    const result = t.preparation.confirmDrafts(orbital.id);

    expect(result).toEqual({ confirmed: 3, flagged: 1, refused: [] });
    expect(texts(t, "to-check")).toEqual(["Took part in the response to 3 phishing incidents."]);
    expect(t.preparation.draftsToCheck().counts).toEqual({ pieces: 4, confirmed: 3, toCheck: 1, flagged: 1, discarded: 0 });
  });
});

describe("pieces whose sources disagree", () => {
  it("become the version Kris picks, waiting to be confirmed like any drafted piece", async () => {
    const t = await imported();
    const piece = t.preparation.draftsToCheck("flagged").groups[0]!.pieces[0]!;

    const result = t.preparation.resolveDispute(piece.id, { version: 1 });

    expect(result).toMatchObject({ saved: true, piece: { status: "unconfirmed", text: "Led the response to 3 phishing incidents.", dispute: null, source: { from: "CV-2025.txt" } } });
    expect(t.preparation.draftsToCheck().counts).toMatchObject({ toCheck: 4, flagged: 0 });
  });

  it("stay flagged when Kris leaves the question to the interview", async () => {
    const t = await imported();
    const piece = t.preparation.draftsToCheck("flagged").groups[0]!.pieces[0]!;

    t.preparation.resolveDispute(piece.id, { askCoach: true });

    expect(t.preparation.draftsToCheck("flagged").groups[0]!.pieces[0]).toMatchObject({ status: "flagged", dispute: { askCoach: true } });
  });

  it("can't be confirmed one by one either, until a version is picked", async () => {
    const t = await imported();
    const piece = t.preparation.draftsToCheck("flagged").groups[0]!.pieces[0]!;

    expect(t.preparation.confirmPiece(piece.id)).toMatchObject({ saved: false });
  });
});

describe("discarding", () => {
  it("takes a piece out of the profile, and restoring it from Discarded brings it back", async () => {
    const t = await imported();
    const dashboard = t.preparation.draftsToCheck().groups[0]!.pieces.find((p) => p.text.startsWith("Built a Splunk dashboard"))!;

    t.preparation.discardPiece(dashboard.id);
    expect(texts(t, "discarded")).toEqual(["Built a Splunk dashboard for the SOC's morning review."]);
    expect(texts(t, "to-check")).not.toContain(dashboard.text);
    expect(t.preparation.listPieces().total).toBe(3);

    t.preparation.restorePiece(dashboard.id);
    expect(texts(t, "discarded")).toEqual([]);
    expect(texts(t, "to-check")).toContain(dashboard.text);
  });

  it("keeps a discarded piece discarded when another file repeats it", async () => {
    const t = await imported();
    const runbook = t.preparation.draftsToCheck().groups[0]!.pieces.find((p) => p.text.startsWith("Wrote the phishing runbook"))!;
    t.preparation.discardPiece(runbook.id);

    const again = await t.preparation.startImport({ files: [txt("CV-2025.txt", cv2025Lines)] });
    if (again.started) await again.done;

    expect(texts(t, "to-check")).not.toContain(runbook.text);
    expect(t.preparation.draftsToCheck().counts.discarded).toBe(1);
  });
});

describe("leaving and coming back", () => {
  it("resumes at the step Kris left, with the same counts", async () => {
    const db = memoryDb();
    const before = await imported({ db });
    before.preparation.setSetupStep("review");
    before.preparation.confirmDrafts(before.preparation.draftsToCheck().groups[0]!.id);
    const left = before.preparation.setupProgress();

    const after = createTestPreparation({ db, writer: writer() });

    expect(after.preparation.setupProgress()).toEqual(left);
    expect(left).toMatchObject({ step: "review", started: true, counts: { pieces: 4, confirmed: 3, toCheck: 1, flagged: 1 } });
  });

  it("starts at Import the first time", () => {
    const t = createTestPreparation();
    expect(t.preparation.setupProgress()).toMatchObject({ step: "import", started: false, skipped: false, finishedAt: null });
  });

  it("keeps the step Kris was on when she skips setup", async () => {
    const t = await imported();
    t.preparation.setSetupStep("review");

    expect(t.preparation.skipSetup()).toMatchObject({ step: "review", skipped: true });
  });
});

describe("your search", () => {
  it("fills the years asked from the role dates while Kris hasn't saved her own", async () => {
    const t = await imported();

    const suggestion = t.preparation.searchSuggestion();

    // Jan 2023 to Oct 2026 (the clock) is 3 years 9 months: jobs asking up to 5 stay.
    expect(suggestion.experience).toEqual({ months: 45, angle: null });
    expect(suggestion.settings.dealbreakers.maxYearsRequired).toBe(5);
    expect(suggestion.saved).toBe(false);
  });

  it("counts overlapping roles once", () => {
    const t = createTestPreparation();
    const add = (organisation: string, start: string, end: string | null) =>
      t.preparation.savePiece({ kind: "role", text: "", angles: ["security"], entry: { title: "Analyst", organisation, city: null, start, end } });
    add("Orbital Bank", "2024-01", null);
    add("Freelance", "2023-07", "2024-06");

    expect(t.preparation.searchSuggestion().experience).toEqual({ months: 39, angle: "security" });
  });

  it("keeps the search settings Kris saved", async () => {
    const t = await imported();
    const mine = await t.discovery.getSearchSettings();
    await t.discovery.saveSearchSettings({ ...mine, dealbreakers: { ...mine.dealbreakers, maxYearsRequired: 2 } });

    expect(t.preparation.searchSuggestion()).toMatchObject({ saved: true, settings: { dealbreakers: { maxYearsRequired: 2 } } });
  });
});

describe("done", () => {
  it("sums up the profile, angles and answer bank, and marks setup finished", async () => {
    const t = await imported();
    t.preparation.confirmDrafts(t.preparation.draftsToCheck().groups[0]!.id);

    const progress = t.preparation.setSetupStep("done");
    const summary = t.preparation.setupSummary();

    expect(progress.finishedAt).toBe("2026-10-12T07:30:00.000Z");
    expect(summary.pieces).toMatchObject({ pieces: 4, confirmed: 3, toCheck: 1 });
    expect(summary.angles).toEqual({ count: 3, thinnest: "Developer" });
    expect(summary.answerBank).toBeGreaterThan(0);
  });
});
