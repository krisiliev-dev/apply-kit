// ————————————————————————————————————————————————
// Pricing table.
//
// Cents per million tokens would be cleaner but we compute totals in USD and
// the UI wants cents of a dollar, so we store $/Mtok directly. Numbers are
// approximate list prices as of shipping — this is a budget estimator, not
// billing. Off-list rates (volume discounts, batch, prompt caching) are not
// modeled.
//
// Ollama and any other local providers are free; we return zeros so the cost
// pill still updates the token counter but doesn't accumulate a dollar value.
// ————————————————————————————————————————————————

import type { ModelProvider } from "@/lib/settings/types";

export type PriceRate = {
  /** USD per million input tokens. */
  inputPerMtok: number;
  /** USD per million output tokens. */
  outputPerMtok: number;
};

/** Known Anthropic rate card. Keys are model tags passed to `anthropic()`. */
export const ANTHROPIC_RATES: Record<string, PriceRate> = {
  "claude-sonnet-4-6": { inputPerMtok: 3, outputPerMtok: 15 },
  "claude-sonnet-4-5": { inputPerMtok: 3, outputPerMtok: 15 },
  "claude-haiku-4-5": { inputPerMtok: 0.8, outputPerMtok: 4 },
  "claude-opus-4-7": { inputPerMtok: 15, outputPerMtok: 75 },
};

const DEFAULT_ANTHROPIC_RATE: PriceRate = { inputPerMtok: 3, outputPerMtok: 15 };
const LOCAL_RATE: PriceRate = { inputPerMtok: 0, outputPerMtok: 0 };

export function rateFor(provider: ModelProvider, model: string): PriceRate {
  if (provider === "ollama-openai-compat") return LOCAL_RATE;
  return ANTHROPIC_RATES[model] ?? DEFAULT_ANTHROPIC_RATE;
}

/** USD cost for a single call, given token counts + rate. */
export function computeCostUsd(
  rate: PriceRate,
  inputTokens: number,
  outputTokens: number,
): number {
  const inputs = Math.max(0, safeNum(inputTokens)) / 1_000_000;
  const outputs = Math.max(0, safeNum(outputTokens)) / 1_000_000;
  const cost = inputs * rate.inputPerMtok + outputs * rate.outputPerMtok;
  // Round to 1/100th of a cent — the pill rounds further, but the ledger
  // keeps 6-decimal precision so running totals don't drift.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

function safeNum(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n;
}

/** Convenience: "0.032" given a raw USD number. Drops trailing zeros once below 1¢. */
export function formatUsd(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(1)}`;
}

export function formatTokens(n: number): string {
  if (n < 1_000) return `${n} tok`;
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k tok`;
  return `${(n / 1_000_000).toFixed(2)}M tok`;
}
