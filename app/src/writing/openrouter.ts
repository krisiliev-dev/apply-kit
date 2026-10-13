// The real writer: Prepare's only connection to the model. DeepSeek V4.1 Flash through OpenRouter,
// pinned to non-China hosts like the extractor (../openrouter.ts), with schema-validated structured
// output per task. Each task sends only the text it needs (extracted text, never files).
import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { z } from "zod";
import { draftedPiecesSchema, type Writer, type WriterRequest, type Written } from "@apply-kit/core";
import { billedUsd, openRouterModel, tokensIn, usdFor, type OpenRouterOptions } from "../openrouter.ts";

const MAX_OUTPUT_TOKENS = 8_000;
/** Output tokens a task typically needs at most, for the estimate. */
const EXPECTED_OUTPUT_TOKENS = 4_000;
const TIMEOUT_MS = 90_000;
/** Instructions plus the JSON schema add roughly this many characters to every request. */
const SCHEMA_CHARS = 3_000;

export type OpenRouterWriterOptions = OpenRouterOptions;

const draftPiecesInstructions = `You read the text of one of Kris's old CVs and draft profile pieces from it, as JSON matching the schema. Rules:
- Only what the text says. Never add a skill, number, employer, title or date that isn't in it.
- One piece per role, achievement, skill or education entry.
- Every "quote" is copied word for word from the text: the line the piece came from.`;

/** What each task sends: its instructions and the prompt built from its input. */
function promptOf(request: WriterRequest): { instructions: string; prompt: string } {
  switch (request.task) {
    case "draft-pieces":
      return { instructions: draftPiecesInstructions, prompt: `File: ${request.input.fileName}\n\n${request.input.text}` };
  }
}

export function createOpenRouterWriter(options: OpenRouterWriterOptions): Writer {
  const { model, modelId } = openRouterModel(options);

  /** One schema-validated call. A failed call that was still billed throws with its `costUsd`. */
  async function write<T>(request: WriterRequest, schema: z.ZodType<T>, name: string): Promise<Written<T>> {
    const { instructions, prompt } = promptOf(request);
    try {
      const result = await generateText({
        model,
        instructions,
        prompt,
        output: Output.object({ schema, name }),
        temperature: 0.3,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        timeout: TIMEOUT_MS,
      });
      return { output: result.output, costUsd: billedUsd(result, MAX_OUTPUT_TOKENS), model: result.response.modelId || modelId, excerpts: [] };
    } catch (err) {
      // The model answered but not in the schema's shape: the call was billed all the same.
      if (NoObjectGeneratedError.isInstance(err) && err.usage) Object.assign(err, { costUsd: billedUsd({ usage: err.usage }, MAX_OUTPUT_TOKENS) });
      throw err;
    }
  }

  return {
    estimateCostUsd(request) {
      const { instructions, prompt } = promptOf(request);
      return usdFor(tokensIn(instructions.length + prompt.length + SCHEMA_CHARS), EXPECTED_OUTPUT_TOKENS);
    },
    draftPieces: (input) => write({ task: "draft-pieces", input }, draftedPiecesSchema, "drafted_pieces"),
  };
}
