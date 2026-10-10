/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendLedgerEntry,
  clearLedger,
} from "@/lib/ai/tokenLedger";
import type { UsageEnvelope } from "@/lib/ai/tokenTracker";

// jsdom gives us `window.localStorage` so the ledger's persistence branch
// exercises. We reset state between tests to keep each one hermetic.

function makeEntry(
  overrides: Partial<UsageEnvelope> = {},
): UsageEnvelope {
  return {
    feature: "default",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    costUsd: 1000 / 1_000_000 * 3 + 500 / 1_000_000 * 15, // = 0.0105
    at: Date.now(),
    ...overrides,
  };
}

// Because the ledger module is stateful (cache in module scope), we
// re-import fresh each test via vitest's `resetModules`.
async function freshLedger() {
  // vitest automatically resets module registry between tests when
  // `clearMocks: true` is set, but we're fine re-using the exported bindings
  // as long as we clear localStorage + call clearLedger() ourselves.
  clearLedger();
}

describe("tokenLedger", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await freshLedger();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("appending sums costs, inputs, and outputs", async () => {
    const { useTokenLedger } = await import("@/lib/ai/tokenLedger");
    appendLedgerEntry(makeEntry({ costUsd: 0.01, inputTokens: 100, outputTokens: 50, totalTokens: 150 }));
    appendLedgerEntry(makeEntry({ costUsd: 0.02, inputTokens: 200, outputTokens: 100, totalTokens: 300 }));
    // We can't call the React hook outside a component, so read localStorage
    // directly.
    const raw = window.localStorage.getItem("cv-maker:token-ledger");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as UsageEnvelope[];
    expect(parsed.length).toBe(2);
    const cost = parsed.reduce((s, e) => s + e.costUsd, 0);
    expect(cost).toBeCloseTo(0.03, 5);
    const tokens = parsed.reduce(
      (s, e) => s + e.inputTokens + e.outputTokens,
      0,
    );
    expect(tokens).toBe(450);
    // Sanity: hook exists and is callable (we don't invoke it here, just
    // verify exports didn't disappear).
    expect(typeof useTokenLedger).toBe("function");
  });

  it("trims the ledger to 500 entries — oldest dropped first", () => {
    for (let i = 0; i < 520; i++) {
      appendLedgerEntry(makeEntry({ at: i, costUsd: 0.0001 * i, totalTokens: i }));
    }
    const raw = window.localStorage.getItem("cv-maker:token-ledger");
    const parsed = JSON.parse(raw as string) as UsageEnvelope[];
    expect(parsed.length).toBe(500);
    // Oldest entries (at=0..19) should have been dropped.
    expect(parsed[0].at).toBe(20);
    expect(parsed[499].at).toBe(519);
  });

  it("clearLedger wipes localStorage and totals", () => {
    appendLedgerEntry(makeEntry());
    expect(window.localStorage.getItem("cv-maker:token-ledger")).toBeTruthy();
    clearLedger();
    expect(window.localStorage.getItem("cv-maker:token-ledger")).toBeNull();
  });

  it("tracks zero-cost Ollama entries alongside paid ones", () => {
    appendLedgerEntry(
      makeEntry({
        provider: "ollama-openai-compat",
        model: "qwen2.5-coder:32b",
        costUsd: 0,
        inputTokens: 1000,
        outputTokens: 1000,
        totalTokens: 2000,
      }),
    );
    appendLedgerEntry(makeEntry({ costUsd: 0.05 }));
    const raw = window.localStorage.getItem("cv-maker:token-ledger");
    const parsed = JSON.parse(raw as string) as UsageEnvelope[];
    expect(parsed.length).toBe(2);
    const cost = parsed.reduce((s, e) => s + e.costUsd, 0);
    // Only the paid entry contributes.
    expect(cost).toBeCloseTo(0.05, 5);
  });
});
