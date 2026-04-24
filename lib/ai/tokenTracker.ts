import type { LanguageModelUsage } from "ai";
import type { ModelChoice, ModelFeature } from "@/lib/settings/types";
import { computeCostUsd, rateFor } from "./pricing";

// ————————————————————————————————————————————————
// Token / cost tracker.
//
// The AI SDK's streamText / generateText / generateObject results all expose
// a `usage` promise/value shaped like `LanguageModelUsage`. We serialise it
// into a single `x-cv-usage` response header so the browser ledger can read
// it regardless of whether the body is JSON or a streaming text body.
//
// The header carries base64-encoded JSON with:
//   { feature, provider, model, inputTokens, outputTokens, totalTokens,
//     costUsd, at }
// ————————————————————————————————————————————————

export type UsageEnvelope = {
  feature: ModelFeature;
  provider: ModelChoice["provider"];
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  at: number;
};

export const USAGE_HEADER = "x-cv-usage";

/** Build a usage envelope from a final usage value + the choice that produced it. */
export function buildUsageEnvelope(args: {
  feature: ModelFeature;
  choice: ModelChoice;
  usage: LanguageModelUsage | null | undefined;
}): UsageEnvelope {
  const rate = rateFor(args.choice.provider, args.choice.model);
  const input = normaliseCount(args.usage?.inputTokens);
  const output = normaliseCount(args.usage?.outputTokens);
  const total = normaliseCount(args.usage?.totalTokens) || input + output;
  return {
    feature: args.feature,
    provider: args.choice.provider,
    model: args.choice.model,
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    costUsd: computeCostUsd(rate, input, output),
    at: Date.now(),
  };
}

function normaliseCount(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0;
  return Math.round(v);
}

/** Serialise → base64(JSON). Kept narrow because header length is the limit. */
export function encodeUsageHeader(env: UsageEnvelope): string {
  const json = JSON.stringify(env);
  if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(json)));
  return Buffer.from(json, "utf8").toString("base64");
}

/** Parse `x-cv-usage`. Returns null on malformed input. */
export function decodeUsageHeader(value: string | null | undefined): UsageEnvelope | null {
  if (!value) return null;
  try {
    const json =
      typeof atob === "function"
        ? decodeURIComponent(escape(atob(value)))
        : Buffer.from(value, "base64").toString("utf8");
    const parsed = JSON.parse(json) as UsageEnvelope;
    if (typeof parsed.model !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Attach the usage header to an existing Response. If the response is a
 * streaming body, we can't wait for its `.usage` — callers build the envelope
 * from the `totalUsage` / `usage` promise resolved AFTER stream end. That
 * only helps JSON responses. For streaming routes we fall back to a best-
 * effort envelope with zero tokens, and the client ledger updates the
 * counter only for JSON calls. This is documented in README / docs/models.md.
 */
export function withUsageHeader(res: Response, env: UsageEnvelope): Response {
  const headers = new Headers(res.headers);
  headers.set(USAGE_HEADER, encodeUsageHeader(env));
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
