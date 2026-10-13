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

  it("leaves postings unscreened once writing has used the cap", async () => {
    const writer = fakeWriter({}, { costUsd: 0.008 });
    const extractor = fakeExtractor({}, { costUsd: 0.004 });
    const t = await withKestrelJobs({ capUsd: 0.01, extractor, writer });

    const drafted = await t.budget.call({ task: "draft-pieces", estimateUsd: 0.008 }, () => writer.draftPieces(cvText));
    const read = await t.discovery.readPending();

    expect(drafted).toEqual({ refused: false, result: expect.objectContaining({ output: recordedDraftPieces }) });
    expect(extractor.calls).toEqual([]);
    expect(read).toMatchObject({ read: 0, unscreened: 2 });
    expect((await t.discovery.queryFeed({ view: "new" })).budget).toEqual({ month: "2026-10", capUsd: 0.01, spentUsd: 0.008, reached: true });
  });
});
