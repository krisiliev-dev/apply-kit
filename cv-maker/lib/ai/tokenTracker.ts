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

// ————————————————————————————————————————————————
// Stream-end sentinel marker.
//
// The `x-cv-usage` header is sent before token counts are final for streams.
// To fix that, streaming routes append a trailing marker INSIDE the body once
// `streamText`'s `onFinish` resolves. The marker uses zero-width-space
// delimiters so it never shows up in normal prose output and is easy to scan
// for on the client without accidentally matching user-visible text.
//
// Format: `​​cv-usage:<base64-json>​​`
//
// NDJSON streams use their own line-oriented protocol and emit
// `{"__cvUsage":<envelope>}` on a dedicated line instead — callers should
// parse that as a normal NDJSON frame before falling through to sentinel
// scanning.
// ————————————————————————————————————————————————

export const STREAM_USAGE_SENTINEL_PREFIX = "​​cv-usage:";
export const STREAM_USAGE_SENTINEL_SUFFIX = "​​";
export const NDJSON_USAGE_KEY = "__cvUsage";

/** Serialise a usage envelope as an in-stream sentinel for text/plain/SSE bodies. */
export function encodeUsageSentinel(env: UsageEnvelope): string {
  return (
    STREAM_USAGE_SENTINEL_PREFIX +
    encodeUsageHeader(env) +
    STREAM_USAGE_SENTINEL_SUFFIX
  );
}

/**
 * Scan a buffer tail for an embedded `cv-usage` sentinel and return the
 * parsed envelope on match (or null if none / malformed).
 *
 * The scan looks at the last ~2KB of buffer so it's constant-time regardless
 * of stream length. Callers that also parse a structured protocol (NDJSON)
 * should check their protocol first and only fall through to this as a
 * fallback for flat text streams.
 */
export function extractUsageSentinel(buffer: string): UsageEnvelope | null {
  const slice = buffer.length > 2048 ? buffer.slice(buffer.length - 2048) : buffer;
  const prefixIdx = slice.lastIndexOf(STREAM_USAGE_SENTINEL_PREFIX);
  if (prefixIdx === -1) return null;
  const startPayload = prefixIdx + STREAM_USAGE_SENTINEL_PREFIX.length;
  const suffixIdx = slice.indexOf(STREAM_USAGE_SENTINEL_SUFFIX, startPayload);
  if (suffixIdx === -1) return null;
  const payload = slice.slice(startPayload, suffixIdx);
  return decodeUsageHeader(payload);
}

/**
 * Scan NDJSON text for a `{"__cvUsage":…}` line and return the envelope.
 * Returns null if no such frame exists.
 */
export function extractNdjsonUsage(buffer: string): UsageEnvelope | null {
  const lines = buffer.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{") || !line.includes(NDJSON_USAGE_KEY)) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const candidate = parsed[NDJSON_USAGE_KEY];
      if (candidate && typeof candidate === "object") {
        const env = candidate as UsageEnvelope;
        if (typeof env.model === "string") return env;
      }
    } catch {
      // fall through
    }
  }
  return null;
}
