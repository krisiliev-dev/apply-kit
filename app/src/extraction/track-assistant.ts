// The real Track assistant: the same OpenRouter setup as extraction (DeepSeek V4.1 Flash, pinned
// non-China hosts that don't store or train on prompts, schema-validated output). Only the minimum
// of an email goes out: sender, subject, date and its text (trimmed); never attachments.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { emailClassificationSchema, type ClassifyInput, type TrackAssistant } from "@apply-kit/core";
import { DEFAULT_MODEL, DEFAULT_PROVIDERS, providerRouting } from "./openrouter.ts";

/** Prices the estimate assumes (the routing's max price per million tokens), and output limits. */
const PRICE = { prompt: 0.5, completion: 2 };
const MAX_OUTPUT_TOKENS = 600;
const TIMEOUT_MS = 30_000;

const instructions = `You read one email from a job seeker's job mailbox and classify it as JSON matching the schema. Rules:
- kind: "confirmation" (an automatic "we received your application"), "rejection", "interview-invitation" (any invitation
  to talk: a call, a video interview, an on-site), "offer", "info-request" (a person asking for information or documents),
  or "other" (newsletters, marketing, anything not about one of the job seeker's applications).
- stage: for an interview-invitation only: "screening" for a first call with a recruiter or HR, "interview" for anything
  later or with the team. Otherwise null.
- company and jobTitle: as the email writes them (original language), or null when it doesn't name them. Never guess.
- language: the email's ISO 639-1 code, such as "en" or "bg".
- summary: for an email not in English, one short plain-English line saying what it says; null for English mail.
- confidence (0 to 1): 0.9+ only when the kind is unmistakable; 0.5-0.7 when you had to interpret; lower when unsure.
  Be honest: below 0.8 nothing changes without the job seeker confirming.`;

export interface TrackAssistantOptions {
  apiKey: string;
  model?: string;
  providers?: string[];
  fetch?: typeof fetch;
}

export function createOpenRouterTrackAssistant(options: TrackAssistantOptions): TrackAssistant {
  const modelId = options.model || DEFAULT_MODEL;
  const routing = providerRouting(options.providers?.length ? options.providers : DEFAULT_PROVIDERS);
  const openrouter = createOpenRouter({ apiKey: options.apiKey, fetch: options.fetch });
  const model = openrouter(modelId, { provider: routing, usage: { include: true } });

  const promptFor = (input: ClassifyInput) =>
    `From: ${input.from}\nDate: ${input.receivedAt}\nSubject: ${input.subject}\n\n${input.text}`;
  /** Characters per token, low on purpose (Cyrillic tokenises densely) so the estimate stays high. */
  const tokens = (chars: number) => Math.ceil(chars / 2.5);
  const usd = (prompt: number, completion: number) => (prompt * PRICE.prompt + completion * PRICE.completion) / 1_000_000;

  return {
    estimateClassifyUsd(input) {
      return usd(tokens(instructions.length + promptFor(input).length + 1_500), MAX_OUTPUT_TOKENS);
    },
    async classify(input) {
      const result = await generateText({
        model,
        instructions,
        prompt: promptFor(input),
        output: Output.object({ schema: emailClassificationSchema, name: "email_classification" }),
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        timeout: TIMEOUT_MS,
      });
      const reported = (result.providerMetadata?.openrouter as { usage?: { cost?: unknown } } | undefined)?.usage?.cost;
      const costUsd = typeof reported === "number" && Number.isFinite(reported)
        ? reported
        : usd(result.usage.inputTokens ?? 0, result.usage.outputTokens ?? MAX_OUTPUT_TOKENS);
      return { classification: result.output, costUsd, model: result.response.modelId || modelId };
    },
  };
}
