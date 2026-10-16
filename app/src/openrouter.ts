// The model setup the extractor and the writer share: DeepSeek V4.1 Flash through OpenRouter, via
// the Vercel AI SDK, with providers pinned to hosts outside China that don't store or train on
// prompts (PRODUCT.md, privacy constraint), a price ceiling, and how a call's cost is worked out.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { NoObjectGeneratedError, type LanguageModel } from "ai";

export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";

/**
 * OpenRouter provider slugs that host in mainland China (or are its first-party APIs). Always sent
 * as `ignore`, and removed from any configured allow-list. Matched on the base slug.
 */
export const CHINA_HOSTED_PROVIDERS = [
  "deepseek", "baidu", "alibaba", "siliconflow", "streamlake", "volcengine", "bytedance", "tencent",
  "moonshotai", "z-ai", "zhipu", "minimax", "stepfun", "baichuan", "01-ai", "qwen", "iflytek", "ppio",
];

/**
 * Default allow-list: US-based hosts listed for this model on OpenRouter (checked 2026-10-11 via
 * /api/v1/models/deepseek/deepseek-v4.1-flash/endpoints). Override with OPENROUTER_PROVIDERS.
 */
export const DEFAULT_PROVIDERS = ["deepinfra", "together", "fireworks", "coreweave", "baseten", "parasail", "crusoe", "digitalocean", "modal"];

/** Highest price accepted per million tokens (USD). Also the prices cost estimates assume. */
export const MAX_PRICE = { prompt: 0.5, completion: 2 };

export interface Price {
  prompt: number;
  completion: number;
}

export interface OpenRouterOptions {
  apiKey: string;
  model?: string;
  /** Provider slugs to allow; China-hosted ones are dropped. Defaults to DEFAULT_PROVIDERS. */
  providers?: string[];
  /** Highest price accepted per million tokens (USD), and the prices estimates assume. Defaults to MAX_PRICE. */
  maxPrice?: Price;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

const baseSlug = (slug: string) => slug.trim().toLowerCase().split("/")[0]!;

/** The routing preferences sent with every request (exported for the record; tests check the request itself). */
export function providerRouting(providers: string[] = DEFAULT_PROVIDERS, maxPrice: Price = MAX_PRICE) {
  const only = providers.map((p) => p.trim().toLowerCase()).filter((p) => p && !CHINA_HOSTED_PROVIDERS.includes(baseSlug(p)));
  if (only.length === 0) throw new Error("OPENROUTER_PROVIDERS lists no non-China provider; the model needs at least one");
  return {
    only,
    ignore: CHINA_HOSTED_PROVIDERS,
    data_collection: "deny" as const,
    allow_fallbacks: true,
    require_parameters: true,
    max_price: maxPrice,
  };
}

/** The pinned model, and its id as configured. */
export function openRouterModel(options: OpenRouterOptions): { modelId: string; model: LanguageModel } {
  const modelId = options.model || DEFAULT_MODEL;
  const routing = providerRouting(options.providers?.length ? options.providers : DEFAULT_PROVIDERS, options.maxPrice);
  const openrouter = createOpenRouter({ apiKey: options.apiKey, fetch: options.fetch });
  return { modelId, model: openrouter(modelId, { provider: routing, usage: { include: true } }) };
}

/** Tokens in this many characters, counted low on purpose (Cyrillic tokenises densely) so estimates stay high. */
export const tokensIn = (chars: number) => Math.ceil(chars / 2.5);

/** USD for these token counts at the price ceiling. */
export const usdFor = (promptTokens: number, completionTokens: number, price: Price = MAX_PRICE) =>
  (promptTokens * price.prompt + completionTokens * price.completion) / 1_000_000;

/** What a finished call cost: as OpenRouter reports it, else worked out from its tokens at the price ceiling. */
export function billedUsd(result: { providerMetadata?: unknown; usage?: { inputTokens?: number; outputTokens?: number } }, maxOutputTokens: number, price: Price = MAX_PRICE): number {
  const reported = ((result.providerMetadata as { openrouter?: { usage?: { cost?: unknown } } } | undefined)?.openrouter)?.usage?.cost;
  return typeof reported === "number" && Number.isFinite(reported)
    ? reported
    : usdFor(result.usage?.inputTokens ?? 0, result.usage?.outputTokens ?? maxOutputTokens, price);
}

/** A rejected structured response can still be billed; keep its usage for the shared budget. */
export function rethrowBilledFailure(err: unknown, maxOutputTokens: number, price: Price = MAX_PRICE): never {
  if (NoObjectGeneratedError.isInstance(err) && err.usage) Object.assign(err, { costUsd: billedUsd({ usage: err.usage }, maxOutputTokens, price) });
  throw err;
}
