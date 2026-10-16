// The real extractor: DeepSeek V4.1 Flash through OpenRouter, via the Vercel AI SDK with
// schema-validated structured output. With the writer (writing/openrouter.ts), the only modules that
// call the model; both use the pinned setup in ../openrouter.ts.
import { generateText, Output } from "ai";
import { postingLanguageCode, postingFactsSchema, type ExtractionInput, type Extractor } from "@apply-kit/core";
import { billedUsd, rethrowBilledFailure, openRouterModel, tokensIn, usdFor, type OpenRouterOptions } from "../openrouter.ts";

export { CHINA_HOSTED_PROVIDERS, DEFAULT_MODEL, DEFAULT_PROVIDERS, providerRouting } from "../openrouter.ts";

const MAX_OUTPUT_TOKENS = 4_000;
/** Output tokens a read typically needs, for the estimate (well above the usual ~1,000). */
const EXPECTED_OUTPUT_TOKENS = 2_500;
const TIMEOUT_MS = 60_000;

export type OpenRouterExtractorOptions = OpenRouterOptions;

const instructions = `You read one job posting and return its facts as JSON matching the schema. Rules:
- Only report what the posting says. Never guess. If something isn't stated, use "not-stated", null or an empty list.
- Every "quote" is copied word for word from the posting, in its original language, short (one line or sentence).
  If the posting isn't in English, give an English "translation" of each quote; otherwise translation is null.
- Top-level "language": the ISO 639-1 code of the posting’s written language ("bg" for Bulgarian, "en" for English), never its name.
- Labels, summaries, names in "languages" and "about" are short plain English, even for Bulgarian postings.
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
  const { model, modelId } = openRouterModel(options);

  const promptFor = (input: ExtractionInput) =>
    `Job title: ${input.title}\nCompany: ${input.company}\nLocation as listed: ${input.location ?? "not listed"}\n\nPosting:\n${input.text}`;

  return {
    estimateCostUsd(input) {
      // Instructions plus the JSON schema add roughly 3,000 characters to every request.
      return usdFor(tokensIn(instructions.length + promptFor(input).length + 3_000), EXPECTED_OUTPUT_TOKENS);
    },

    async extract(input) {
      try {
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
        const facts = { ...result.output, language: postingLanguageCode(result.output.language) };
        return { facts, costUsd: billedUsd(result, MAX_OUTPUT_TOKENS), model: result.response.modelId || modelId };
      } catch (err) {
        rethrowBilledFailure(err, MAX_OUTPUT_TOKENS);
      }
    },
  };
}
