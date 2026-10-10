import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_RATES,
  computeCostUsd,
  formatTokens,
  formatUsd,
  rateFor,
} from "@/lib/ai/pricing";

describe("pricing table", () => {
  it("exposes rates for the shipped Claude models", () => {
    expect(ANTHROPIC_RATES["claude-sonnet-4-6"]).toEqual({
      inputPerMtok: 3,
      outputPerMtok: 15,
    });
    expect(ANTHROPIC_RATES["claude-haiku-4-5"]).toEqual({
      inputPerMtok: 0.8,
      outputPerMtok: 4,
    });
    expect(ANTHROPIC_RATES["claude-opus-4-7"]).toEqual({
      inputPerMtok: 15,
      outputPerMtok: 75,
    });
  });

  it("rateFor returns Anthropic rates for anthropic provider", () => {
    expect(rateFor("anthropic", "claude-sonnet-4-6").inputPerMtok).toBe(3);
  });

  it("rateFor falls back to a sensible default for unknown Anthropic tags", () => {
    const r = rateFor("anthropic", "claude-unreleased-model");
    expect(r.inputPerMtok).toBeGreaterThan(0);
    expect(r.outputPerMtok).toBeGreaterThan(0);
  });

  it("rateFor returns zero rates for local ollama", () => {
    expect(rateFor("ollama-openai-compat", "qwen2.5-coder:32b")).toEqual({
      inputPerMtok: 0,
      outputPerMtok: 0,
    });
  });
});

describe("computeCostUsd", () => {
  it("computes zero for zero tokens", () => {
    expect(computeCostUsd({ inputPerMtok: 3, outputPerMtok: 15 }, 0, 0)).toBe(0);
  });

  it("computes Sonnet 4.6 cost correctly for a million tokens round", () => {
    // 1Mtok in, 1Mtok out → $3 + $15 = $18
    expect(
      computeCostUsd(
        { inputPerMtok: 3, outputPerMtok: 15 },
        1_000_000,
        1_000_000,
      ),
    ).toBe(18);
  });

  it("computes Haiku 4.5 cost on a realistic call", () => {
    // 2000 in, 500 out → 2000/1M * 0.8 + 500/1M * 4 = 0.0016 + 0.002 = 0.0036
    const cost = computeCostUsd(
      { inputPerMtok: 0.8, outputPerMtok: 4 },
      2000,
      500,
    );
    expect(cost).toBeCloseTo(0.0036, 4);
  });

  it("computes Opus 4.7 cost at the higher premium band", () => {
    // 10k in, 5k out
    const cost = computeCostUsd(
      { inputPerMtok: 15, outputPerMtok: 75 },
      10_000,
      5_000,
    );
    // 0.15 + 0.375 = 0.525
    expect(cost).toBeCloseTo(0.525, 3);
  });

  it("clamps negative / NaN inputs to zero", () => {
    expect(
      computeCostUsd({ inputPerMtok: 3, outputPerMtok: 15 }, -100, Number.NaN),
    ).toBe(0);
  });

  it("returns zero for local (ollama) rates even at high volume", () => {
    expect(
      computeCostUsd(
        { inputPerMtok: 0, outputPerMtok: 0 },
        5_000_000,
        5_000_000,
      ),
    ).toBe(0);
  });
});

describe("formatUsd / formatTokens", () => {
  it("formats zero cost as $0.00", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });
  it("formats sub-cent as <$0.01", () => {
    expect(formatUsd(0.003)).toBe("<$0.01");
  });
  it("formats 3-decimal cents between 1¢ and $1", () => {
    expect(formatUsd(0.032)).toBe("$0.032");
  });
  it("formats dollars with 2 decimals below $100", () => {
    expect(formatUsd(12.34)).toBe("$12.34");
  });
  it("formats large totals with one decimal", () => {
    expect(formatUsd(1234.5)).toBe("$1234.5");
  });

  it("formats tokens below 1k raw", () => {
    expect(formatTokens(0)).toBe("0 tok");
    expect(formatTokens(42)).toBe("42 tok");
  });
  it("formats thousands with k", () => {
    expect(formatTokens(12_400)).toBe("12.4k tok");
  });
  it("formats millions with M", () => {
    expect(formatTokens(2_350_000)).toBe("2.35M tok");
  });
});
