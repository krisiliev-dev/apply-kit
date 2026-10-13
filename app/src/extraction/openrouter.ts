// The real extractor: DeepSeek V4.1 Flash through OpenRouter, via the Vercel AI SDK with
// schema-validated structured output. The only module that imports `ai`. Providers are pinned to
// hosts outside China that don't store or train on prompts (PRODUCT.md, privacy constraint).
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { postingFactsSchema, type ExtractionInput, type Extractor } from "@apply-kit/core";

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

/** Highest price accepted per million tokens (USD). Also the prices the cost estimate assumes. */
const MAX_PRICE = { prompt: 0.5, completion: 2 };
const MAX_OUTPUT_TOKENS = 4_000;
/** Output tokens a read typically needs, for the estimate (well above the usual ~1,000). */
const EXPECTED_OUTPUT_TOKENS = 2_500;
const TIMEOUT_MS = 60_000;

export interface OpenRouterExtractorOptions {
  apiKey: string;
  model?: string;
  /** Provider slugs to allow; China-hosted ones are dropped. Defaults to DEFAULT_PROVIDERS. */
  providers?: string[];
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

const baseSlug = (slug: string) => slug.trim().toLowerCase().split("/")[0]!;

/** The routing preferences sent with every request (exported for the record; tests check the request itself). */
export function providerRouting(providers: string[] = DEFAULT_PROVIDERS) {
  const only = providers.map((p) => p.trim().toLowerCase()).filter((p) => p && !CHINA_HOSTED_PROVIDERS.includes(baseSlug(p)));
  if (only.length === 0) throw new Error("OPENROUTER_PROVIDERS lists no non-China provider; extraction needs at least one");
  return {
    only,
    ignore: CHINA_HOSTED_PROVIDERS,
    data_collection: "deny" as const,
    allow_fallbacks: false,
    require_parameters: true,
    max_price: MAX_PRICE,
  };
}

const instructions = `You read one job posting and return its facts as JSON matching the schema. Rules:
- Only report what the posting says. Never guess. If something isn't stated, use "not-stated", null or an empty list.
- Every "quote" is copied word for word from the posting, in its original language, short (one line or sentence).
  If the posting isn't in English, give an English "translation" of each quote; otherwise translation is null.
- Labels, summaries, language names and "about" are short plain English, even for Bulgarian postings.
- titleTranslation: the job title in plain English if the posting isn't in English; otherwise null.
- "required" is anything the posting asks for as a must. Items under headings like "Nice to have", "Bonus",
  "Preferred", "Plus", or worded "ideally", "a plus", "is an advantage" are "preferred".
- requirements: every skill, experience, language, certificate, education, location or work-authorisation ask.
  years, languages and certificates repeat the matching asks in structured form.
- salary: amounts as plain numbers (5.5k = 5500). currency is an ISO code only if the posting states it or its
  symbol; period and gross/net only if stated. A salary you had to interpret gets low confidence.
- confidence (0 to 1): 0.9+ when stated plainly; 0.5–0.7 when you had to interpret; below 0.5 when unclear
  (two different numbers, no currency, ambiguous section). Be honest: low confidence is shown to the user to confirm.`;

export function createOpenRouterExtractor(options: OpenRouterExtractorOptions): Extractor {
  const modelId = options.model || DEFAULT_MODEL;
  const routing = providerRouting(options.providers?.length ? options.providers : DEFAULT_PROVIDERS);
  const openrouter = createOpenRouter({ apiKey: options.apiKey, fetch: options.fetch });
  const model = openrouter(modelId, { provider: routing, usage: { include: true } });

  const promptFor = (input: ExtractionInput) =>
    `Job title: ${input.title}\nCompany: ${input.company}\nLocation as listed: ${input.location ?? "not listed"}\n\nPosting:\n${input.text}`;
  /** Characters per token, low on purpose (Cyrillic tokenises densely) so the estimate stays high. */
  const tokens = (chars: number) => Math.ceil(chars / 2.5);
  const usd = (promptTokens: number, completionTokens: number) =>
    (promptTokens * MAX_PRICE.prompt + completionTokens * MAX_PRICE.completion) / 1_000_000;

  return {
    estimateCostUsd(input) {
      // Instructions plus the JSON schema add roughly 3,000 characters to every request.
      return usd(tokens(instructions.length + promptFor(input).length + 3_000), EXPECTED_OUTPUT_TOKENS);
    },

    async extract(input) {
      const result = await generateText({
        model,
        instructions,
        prompt: promptFor(input),
        output: Output.object({ schema: postingFactsSchema, name: "posting_facts" }),
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        timeout: TIMEOUT_MS,
      });
      const reported = (result.providerMetadata?.openrouter as { usage?: { cost?: unknown } } | undefined)?.usage?.cost;
      const costUsd = typeof reported === "number" && Number.isFinite(reported)
        ? reported
        : usd(result.usage.inputTokens ?? 0, result.usage.outputTokens ?? MAX_OUTPUT_TOKENS);
      return { facts: result.output, costUsd, model: result.response.modelId || modelId };
    },
  };
}
