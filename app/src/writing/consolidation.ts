import { generateText, Output } from "ai";
import { z } from "zod";
import type { ProfileConsolidator, ProfilePiece } from "@apply-kit/core";
import { billedUsd, openRouterModel, rethrowBilledFailure, tokensIn, usdFor, type OpenRouterOptions } from "../openrouter.ts";

const schema = z.object({ groups: z.array(z.object({ ids: z.array(z.string()), reason: z.string() })) });
const maxOutputTokens = 6_000;
const instructions = `Reconcile overlapping CV, LinkedIn and GitHub imports for one person's master profile.
Return duplicate groups using ONLY IDs provided. A group contains at least two pieces of the same kind.
Each ID appears in at most one group. Omit unique pieces. Never invent, rewrite or combine facts.
Group roles first: same employer and same employment period, with equivalent job titles. A current role in an older CV and an ended role in a later CV may be the same employment. Keep promotions, repeated employment and different seniority distinct. Flag uncertainty by leaving pieces separate.
Then group achievements and skills that express the SAME fact, even with substantially different wording or language. Facts must belong to the same role, or roles you grouped together. A global skill may match the same skill under one role. Similar topics with distinct responsibilities are different facts.
Different numbers, metrics, ownership (helped versus led), tools or scope are NOT duplicates. A broad responsibility and a specific achievement are not duplicates just because they share a topic. Keep project-specific GitHub work distinct from general skills and responsibilities.
Use high-confidence equivalence only. Reason: a brief plain-English explanation referencing the shared fact or period. These proposals will be reviewed; source quotes and original pieces are preserved locally.`;
const prompt = (pieces: ProfilePiece[]) => JSON.stringify(pieces.map(p => ({ id: p.id, kind: p.kind, text: p.text, entry: p.entry, belongsTo: p.belongsTo, status: p.status, source: p.source.from })));

export function createProfileConsolidator(options: OpenRouterOptions): ProfileConsolidator {
  const { model } = openRouterModel(options);
  return {
    estimateUsd: pieces => usdFor(tokensIn(instructions.length + prompt(pieces).length + 3_000), maxOutputTokens, options.maxPrice),
    async propose(pieces) {
      try {
        const result = await generateText({ model, instructions, prompt: prompt(pieces), output: Output.object({ schema, name: "profile_duplicates" }), temperature: 0, maxOutputTokens, maxRetries: 1, timeout: 90_000 });
        return { groups: result.output.groups, costUsd: billedUsd(result, maxOutputTokens, options.maxPrice) };
      } catch (err) { rethrowBilledFailure(err, maxOutputTokens, options.maxPrice); }
    },
  };
}
