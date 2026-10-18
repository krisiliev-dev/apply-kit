import { describe, expect, it } from "vitest";
import { fakeExtractor, fixtureFetch } from "./harness.ts";
import { createTestPreparation, fakeWriter, recordedDraftPieces } from "./preparation-harness.ts";

const kestrelBoard = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs?content=true";
/** Extracted text of a made-up CV (fictional person). */
const cvText = { fileName: "mira-petrova-cv.pdf", text: "Mira Petrova\nSecurity Analyst, Northwind Bank, 2022–2025\nCut false positives by about a third." };

/** Discovery and preparation sharing one database, clock and AI budget, with the Kestrel board to read. */
async function withKestrelJobs(options: Parameters<typeof createTestPreparation>[0] = {}) {
  const t = createTestPreparation({ fetch: fixtureFetch({ [kestrelBoard]: "greenhouse-kestrel.json" }), ...options });
  await t.discovery.addSource({ kind: "greenhouse", config: "kestrel" });
  await t.discovery.checkAll();
  return t;
}

describe("the shared monthly AI budget", () => {
  it("refuses a writer call that would cross what extraction has already spent this month", async () => {
    // One read costs $0.008 of the $0.01 cap; drafting pieces is estimated at $0.004 more.
    const writer = fakeWriter({}, { estimateUsd: 0.004 });
    const t = await withKestrelJobs({ capUsd: 0.01, extractor: fakeExtractor({}, { costUsd: 0.008 }), writer });
    await t.discovery.readPending();

    const outcome = await t.budget.call(
      { task: "draft-pieces", estimateUsd: writer.estimateCostUsd({ task: "draft-pieces", input: cvText }) },
      () => writer.draftPieces(cvText),
    );

    expect(outcome).toEqual({ refused: true });
    expect(writer.calls).toEqual([]);
    expect(t.preparation.budget()).toEqual({ month: "2026-10", capUsd: 0.01, spentUsd: 0.008, reached: true });
  });

  it("keeps reading postings after a writer call too big for what's left was refused", async () => {
    // A big import is estimated at $0.02, over the whole $0.01 cap; each read costs $0.004.
    const writer = fakeWriter({}, { estimateUsd: 0.02 });
    const extractor = fakeExtractor({}, { costUsd: 0.004 });
    const t = await withKestrelJobs({ capUsd: 0.01, extractor, writer });

    const drafted = await t.budget.call({ task: "draft-pieces", estimateUsd: 0.02 }, () => writer.draftPieces(cvText));
    const budgetAfterRefusal = t.preparation.budget();
    const read = await t.discovery.readPending();

    expect(drafted).toEqual({ refused: true });
    expect(budgetAfterRefusal).toEqual({ month: "2026-10", capUsd: 0.01, spentUsd: 0, reached: false });
    expect(read).toMatchObject({ read: 2, unscreened: 0 });
  });

  it("leaves postings unscreened once writing has used the cap", async () => {
    const writer = fakeWriter({}, { costUsd: 0.008 });
    const extractor = fakeExtractor({}, { costUsd: 0.004 });
    const t = await withKestrelJobs({ capUsd: 0.01, extractor, writer });

    const drafted = await t.budget.call({ task: "draft-pieces", estimateUsd: 0.008 }, () => writer.draftPieces(cvText));
    const read = await t.discovery.readPending();

    expect(drafted).toEqual({ refused: false, result: expect.objectContaining({ output: recordedDraftPieces }) });
    expect(extractor.calls).toEqual([]);
    expect(read).toMatchObject({ read: 0, unscreened: 3 });
    expect((await t.discovery.queryFeed({ view: "new" })).budget).toEqual({ month: "2026-10", capUsd: 0.01, spentUsd: 0.008, reached: true });
  });
});

describe("writer calls within the budget", () => {
  it("books a failed call that was still billed, and lets the error through", async () => {
    const billed = Object.assign(new Error("The model's answer didn't fit the schema"), { costUsd: 0.003 });
    const writer = fakeWriter({ draftPieces: billed });
    const t = createTestPreparation({ capUsd: 0.01, writer });

    const call = t.budget.call({ task: "draft-pieces", estimateUsd: 0.004 }, () => writer.draftPieces(cvText));

    await expect(call).rejects.toThrow("didn't fit the schema");
    expect(t.preparation.budget()).toEqual({ month: "2026-10", capUsd: 0.01, spentUsd: 0.003, reached: false });
  });

  it("books nothing for a failed call that wasn't billed, and frees its estimate", async () => {
    const writer = fakeWriter({ draftPieces: new Error("The model didn't answer within 90 seconds") });
    const t = createTestPreparation({ capUsd: 0.01, writer });

    await expect(t.budget.call({ task: "draft-pieces", estimateUsd: 0.008 }, () => writer.draftPieces(cvText))).rejects.toThrow();
    const retry = await t.budget.call({ task: "draft-pieces", estimateUsd: 0.008 }, () => fakeWriter().draftPieces(cvText));

    expect(retry.refused).toBe(false);
    expect(t.preparation.budget().spentUsd).toBe(0.002);
  });
});

describe("the preparation engine", () => {
  it("starts beside the discovery engine on the same database, with nothing spent yet", () => {
    const t = createTestPreparation();

    expect(t.preparation.budget()).toEqual({ month: "2026-10", capUsd: 10, spentUsd: 0, reached: false });
  });

  it("counts a new month from zero", async () => {
    const writer = fakeWriter({}, { costUsd: 0.01 });
    const t = createTestPreparation({ capUsd: 0.01, writer });
    await t.budget.call({ task: "draft-pieces", estimateUsd: 0.01 }, () => writer.draftPieces(cvText));
    expect(t.preparation.budget().reached).toBe(true);

    t.clock.set("2026-11-01T07:00:00Z");

    expect(t.preparation.budget()).toEqual({ month: "2026-11", capUsd: 0.01, spentUsd: 0, reached: false });
  });
});
