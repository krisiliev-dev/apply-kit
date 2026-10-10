import type { LanguageModelUsage } from "ai";
import type { ModelChoice, ModelFeature, Settings } from "@/lib/settings/types";
import { DEFAULT_SETTINGS } from "@/lib/settings/types";
import {
  ProviderConfigError,
  describeChoice,
  mapProviderError,
  resolveModel,
} from "./provider";
import {
  USAGE_HEADER,
  buildUsageEnvelope,
  encodeUsageHeader,
  encodeUsageSentinel,
  NDJSON_USAGE_KEY,
} from "./tokenTracker";

// ————————————————————————————————————————————————
// Small helpers every AI route reuses.
//
// `resolveForRoute` reads Settings from the request body (backward compat:
// undefined/invalid → DEFAULT_SETTINGS), then returns the LanguageModel and
// the ModelChoice descriptor so the route can stamp a usage header.
//
// `jsonWithUsage` / `streamingWithUsage` build the response with the
// `x-cv-usage` header attached. For streaming routes we can only stamp the
// envelope eagerly (no actual token counts), which is fine — the route can
// also emit a final usage frame in its stream for richer clients.
//
// `respondProviderError` turns a thrown model error into a clean HTTP
// envelope that matches existing clients (anthropic-key-missing → 400,
// ollama-unreachable → 502).
// ————————————————————————————————————————————————

export type ResolvedRoute = {
  model: ReturnType<typeof resolveModel>;
  choice: ModelChoice;
  settings: Settings;
  feature: ModelFeature;
};

/**
 * Pull settings from the request body shape `{ settings?: Settings, ... }`.
 * If the body doesn't carry one, we fall back to DEFAULT_SETTINGS so every
 * legacy caller keeps working. Throws ProviderConfigError on missing
 * credentials so routes can unify error handling.
 */
export function resolveForRoute<T extends { settings?: Settings }>(
  feature: ModelFeature,
  body: T | null | undefined,
): ResolvedRoute {
  const settings = extractSettings(body);
  const choice = describeChoice(feature, settings);
  const model = resolveModel(feature, settings);
  return { model, choice, settings, feature };
}

export function extractSettings(body: unknown): Settings {
  if (!body || typeof body !== "object") return DEFAULT_SETTINGS;
  const candidate = (body as { settings?: unknown }).settings;
  if (!candidate || typeof candidate !== "object") return DEFAULT_SETTINGS;
  // Minimal structural check — if any required section is missing we fall
  // back to defaults rather than trying to merge partials. That keeps old
  // clients safe.
  const s = candidate as Partial<Settings>;
  if (!s.models || !s.backup || !s.ui) return DEFAULT_SETTINGS;
  return candidate as Settings;
}

/** JSON response + usage header. */
export function jsonWithUsage(
  payload: unknown,
  opts: {
    status?: number;
    feature: ModelFeature;
    choice: ModelChoice;
    usage?: LanguageModelUsage | null;
    extraHeaders?: Record<string, string>;
  },
): Response {
  const envelope = buildUsageEnvelope({
    feature: opts.feature,
    choice: opts.choice,
    usage: opts.usage ?? null,
  });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [USAGE_HEADER]: encodeUsageHeader(envelope),
    ...(opts.extraHeaders ?? {}),
  };
  return new Response(JSON.stringify(payload), {
    status: opts.status ?? 200,
    headers,
  });
}

/** Streaming response + usage header (zero-token envelope — streaming can't resolve usage before headers flush). */
export function streamingUsageHeader(opts: {
  feature: ModelFeature;
  choice: ModelChoice;
}): Record<string, string> {
  const envelope = buildUsageEnvelope({
    feature: opts.feature,
    choice: opts.choice,
    usage: null,
  });
  return { [USAGE_HEADER]: encodeUsageHeader(envelope) };
}

/** Map any error from resolveForRoute / model calls into an HTTP envelope. */
export function respondProviderError(
  err: unknown,
  opts: { feature: ModelFeature; choice?: ModelChoice } | { feature: ModelFeature; settings?: Settings },
): Response {
  let choice: ModelChoice;
  if ("choice" in opts && opts.choice) {
    choice = opts.choice;
  } else {
    const s = "settings" in opts ? opts.settings : undefined;
    choice = describeChoice(opts.feature, s);
  }
  const mapped = mapProviderError(err, choice);
  return new Response(JSON.stringify(mapped.body), {
    status: mapped.status,
    headers: { "content-type": "application/json" },
  });
}

/** Identify ProviderConfigError without importing it at every site. */
export function isProviderConfigError(err: unknown): err is ProviderConfigError {
  return err instanceof ProviderConfigError;
}

// ————————————————————————————————————————————————
// Stream wrappers that append an in-stream usage marker.
//
// The `x-cv-usage` header is sent before token counts are final for streams.
// These helpers wrap the response body so a final usage marker is appended
// once the producer (streamText) resolves its `onFinish({ usage })`. The
// client's `trackedFetch` parses the marker and forwards accurate counts to
// the token ledger.
//
// Callers provide a thunk that returns the resolved LanguageModelUsage (or
// null if the producer failed before emitting one). We intentionally defer
// reading it until stream-flush time — by then the upstream `onFinish` has
// already populated it.
// ————————————————————————————————————————————————

/**
 * Wrap a text/plain response so a trailing sentinel with the final usage
 * envelope is appended just before the body closes. For plain text streams
 * (cover letter, pre-screen, follow-up) we can append any Unicode text —
 * consumers just render the body. The zero-width delimiters keep the marker
 * invisible in any textarea that shows the raw stream.
 */
export function withStreamUsageSentinel(
  res: Response,
  opts: {
    feature: ModelFeature;
    choice: ModelChoice;
    getUsage: () => LanguageModelUsage | null | undefined;
  },
): Response {
  if (!res.body) return res;
  const encoder = new TextEncoder();
  const transformed = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      flush(controller) {
        try {
          const envelope = buildUsageEnvelope({
            feature: opts.feature,
            choice: opts.choice,
            usage: opts.getUsage() ?? null,
          });
          controller.enqueue(
            encoder.encode("\n" + encodeUsageSentinel(envelope) + "\n"),
          );
        } catch {
          // never block stream closure on ledger bookkeeping
        }
      },
    }),
  );
  return new Response(transformed, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/**
 * Wrap an SSE (UI-message-stream) response so a trailing usage marker is
 * emitted as a valid SSE comment line. SSE comment lines start with `:` and
 * are silently discarded by spec-compliant parsers, so the AI SDK client
 * ignores it while our fetch wrapper picks it up by scanning for the
 * `cv-usage:` substring.
 *
 * Appended bytes:  `:<zero-width-sentinel>\n\n`
 *
 * Appearing AFTER `data: [DONE]\n\n` which `JsonToSseTransformStream` flushes.
 */
export function withSseUsageSentinel(
  res: Response,
  opts: {
    feature: ModelFeature;
    choice: ModelChoice;
    getUsage: () => LanguageModelUsage | null | undefined;
  },
): Response {
  if (!res.body) return res;
  const encoder = new TextEncoder();
  const transformed = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      flush(controller) {
        try {
          const envelope = buildUsageEnvelope({
            feature: opts.feature,
            choice: opts.choice,
            usage: opts.getUsage() ?? null,
          });
          controller.enqueue(
            encoder.encode(":" + encodeUsageSentinel(envelope) + "\n\n"),
          );
        } catch {
          // never block stream closure on ledger bookkeeping
        }
      },
    }),
  );
  return new Response(transformed, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/**
 * Build the single-line NDJSON frame that streaming NDJSON routes emit as
 * their final frame to surface accurate usage.
 */
export function buildNdjsonUsageFrame(opts: {
  feature: ModelFeature;
  choice: ModelChoice;
  usage: LanguageModelUsage | null | undefined;
}): string {
  const envelope = buildUsageEnvelope({
    feature: opts.feature,
    choice: opts.choice,
    usage: opts.usage ?? null,
  });
  return JSON.stringify({ [NDJSON_USAGE_KEY]: envelope });
}
