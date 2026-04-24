import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import {
  DEFAULT_SETTINGS,
  resolveModelFor,
  type ModelChoice,
  type ModelFeature,
  type Settings,
} from "@/lib/settings/types";

// ————————————————————————————————————————————————
// Central model factory.
//
// All AI-backed routes should go through `resolveModel(feature, settings)`
// instead of calling `anthropic(...)` directly. That way flipping a feature
// over to a local Ollama (or any future provider) is a settings change, not
// a code change.
//
// The resolver:
//   1. Reads the `ModelsConfig` slot for this feature (or falls back to
//      `default`, or to `DEFAULT_SETTINGS` when the caller didn't ship a
//      Settings object at all).
//   2. Dispatches on `provider`. Today: Anthropic hosted and Ollama's
//      OpenAI-compatible endpoint.
//
// Environment gating lives in the provider branches. Anthropic throws when
// ANTHROPIC_API_KEY is missing (matching the existing error text the UI
// already handles). Ollama has no key requirement, but we attach a
// diagnostic helper `probeOllama` that the settings UI calls to verify a
// server is reachable before saving.
// ————————————————————————————————————————————————

/** Thrown when the provider is configured but not usable (e.g. key missing). */
export class ProviderConfigError extends Error {
  readonly code:
    | "anthropic-key-missing"
    | "ollama-unreachable"
    | "unknown-provider";
  readonly httpStatus: number;
  readonly baseUrl?: string;
  constructor(
    message: string,
    opts: {
      code: ProviderConfigError["code"];
      httpStatus: number;
      baseUrl?: string;
    },
  ) {
    super(message);
    this.name = "ProviderConfigError";
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.baseUrl = opts.baseUrl;
  }
}

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

/** Resolve the LanguageModel for a given feature under the given settings. */
export function resolveModel(
  feature: ModelFeature,
  settings?: Settings,
): LanguageModel {
  const s = settings ?? DEFAULT_SETTINGS;
  const choice = resolveModelFor(s, feature);
  return modelFromChoice(choice);
}

/** Returns `{ provider, model, baseUrl }` for header-stamping / ledger use. */
export function describeChoice(
  feature: ModelFeature,
  settings?: Settings,
): ModelChoice {
  const s = settings ?? DEFAULT_SETTINGS;
  return resolveModelFor(s, feature);
}

function modelFromChoice(choice: ModelChoice): LanguageModel {
  if (choice.provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new ProviderConfigError(
        "ANTHROPIC_API_KEY missing. Add it to .env.local and restart the dev server.",
        { code: "anthropic-key-missing", httpStatus: 400 },
      );
    }
    return anthropic(choice.model);
  }

  if (choice.provider === "ollama-openai-compat") {
    const baseURL = (choice.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(
      /\/+$/,
      "",
    );
    // The SDK requires a non-empty apiKey string even when the server doesn't
    // check it. Ollama ignores the Bearer header entirely.
    const provider = createOpenAICompatible({
      name: "ollama",
      baseURL,
      apiKey: "ollama",
    });
    return provider.chatModel(choice.model);
  }

  throw new ProviderConfigError(
    `Unknown provider '${(choice as ModelChoice).provider}'.`,
    { code: "unknown-provider", httpStatus: 400 },
  );
}

/**
 * Maps a thrown error from a model call to an HTTP-friendly envelope.
 * Used by every route's catch block to get a consistent 400/502 story.
 */
export function mapProviderError(
  err: unknown,
  choice: ModelChoice,
): { status: number; body: Record<string, unknown> } {
  if (err instanceof ProviderConfigError) {
    return {
      status: err.httpStatus,
      body: { error: err.message, code: err.code, baseUrl: err.baseUrl },
    };
  }
  const msg = err instanceof Error ? err.message : String(err);

  if (choice.provider === "ollama-openai-compat") {
    const baseUrl = choice.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
    if (isConnectionError(msg)) {
      return {
        status: 502,
        body: {
          error: `Ollama server not reachable at ${baseUrl}. Start it with \`ollama serve\` or switch this feature back to Anthropic under Settings → Models.`,
          code: "ollama-unreachable",
          baseUrl,
        },
      };
    }
    // Other Ollama-side failures (model not pulled, bad request) — surface the
    // raw message but still mark the source so the UI can hint at local-model
    // troubleshooting.
    return {
      status: 502,
      body: {
        error: `Ollama call failed: ${msg}`,
        code: "ollama-call-failed",
        baseUrl,
      },
    };
  }

  return { status: 500, body: { error: msg || "Model call failed." } };
}

function isConnectionError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("econnrefused") ||
    m.includes("enotfound") ||
    m.includes("fetch failed") ||
    m.includes("network error") ||
    m.includes("connect etimedout") ||
    m.includes("socket hang up")
  );
}

// ————————————————————————————————————————————————
// Ollama probe — called by the settings UI + smoke test.
// ————————————————————————————————————————————————

export type ProbeResult = {
  ok: boolean;
  models: string[];
  error?: string;
};

/**
 * Hits `<baseUrl>/models` and returns the list of available models. Any
 * network / parse failure resolves to `{ ok: false, error }` — never throws.
 */
export async function probeOllama(baseUrl?: string): Promise<ProbeResult> {
  const url = (baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
  try {
    const res = await fetch(`${url}/models`, {
      method: "GET",
      headers: { "content-type": "application/json" },
      // 3s is generous for a localhost call; no retries.
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        models: [],
        error: `HTTP ${res.status} from ${url}/models`,
      };
    }
    const body = (await res.json()) as {
      data?: Array<{ id?: string }>;
    };
    const models = Array.isArray(body.data)
      ? body.data
          .map((m) => (typeof m?.id === "string" ? m.id : null))
          .filter((x): x is string => !!x)
      : [];
    return { ok: true, models };
  } catch (err) {
    return {
      ok: false,
      models: [],
      error: err instanceof Error ? err.message : "probe failed",
    };
  }
}
