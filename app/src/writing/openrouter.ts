// The real writer: Prepare's only connection to the model. DeepSeek V4.1 Flash through OpenRouter,
// pinned to non-China hosts like the extractor (../openrouter.ts), with schema-validated structured
// output per task. Each task sends only the text it needs (extracted text, never files).
import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { z } from "zod";
import { coachTurnSchema, draftedPiecesSchema, learnedVoiceSchema, tailoredCvSchema, writtenLetterSchema, type SentExcerpt, type Writer, type WriterRequest, type Written } from "@apply-kit/core";
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
- Every "quote" is copied word for word from the text: the line the piece came from.
- A role or education entry fills "entry": title (or degree), organisation (employer or school), city or null, start and end as "YYYY-MM", or "YYYY" when the text gives only the year; end is null while it's current. Its "text" is its description, or "".
- An achievement is one sentence of at most 200 characters, in the text's own words. Achievements and skills set "role" to the index of the role or education entry they sit under, or null.
- Other pieces have "entry": null; roles and education have "role": null.`;

const learnVoiceInstructions = `You learn how Kris writes, as short readable voice rules, from a few excerpts of Kris's own writing (parts of samples, and edits Kris made to drafts: what the draft said and what Kris wrote instead). Answer as JSON matching the schema. Rules:
- A rule is one plain statement of a habit the excerpts show, e.g. "Opens with the company's problem, not with you" or "Never: "passionate", "team player"". At most 80 characters.
- Return only rules these excerpts show: new ones with "id": null, or ones already known (by their id) with updated evidence. Don't return known rules the excerpts don't touch.
- "evidence" says in a few plain words what shows it, counting what you know, e.g. "3 samples; you rewrote 2 openers".
- "sources" lists the sources of the excerpts that show it, exactly as given.
- "language" is "en" or "bg" when the habit belongs to one language, otherwise null.
- Never suggest a removed rule again from the same kind of evidence.
- Never invent facts about Kris; rules are about style, not about experience.`;

/** The excerpts, labelled with their source, as the model reads them. */
const excerptLines = (excerpts: SentExcerpt[]) => excerpts.map((e) => `[${e.source}]\n${e.text}`).join("\n\n");

const tailorCvInstructions = `You tailor Kris's CV to one job posting, as JSON matching the schema, using only the profile pieces given. Rules:
- Start from the angle given: the summary leads with what the posting asks for first, in one or two sentences.
- "roles" lists the role pieces to show, by "pieceId", with title, employer, start and end copied exactly as given. Each role's "bullets" are its achievements (pieces whose "belongsTo" is that role) in the order that fits the posting best; leave out the ones least relevant to it, and say why in the role's "why".
- Every line cites the ids of the pieces it relies on ("pieceIds"). Never cite an id that isn't given, and never put an achievement under a role it doesn't belong to.
- You may use the posting's term for the same thing ("alert triage" for "alert monitoring"). Never add a skill, tool, employer, number or date that isn't in the cited pieces; numbers keep the precision of their piece ("about a third" stays about a third).
- "claim" says how the line compares to its pieces: "as-written" (the piece's own words), "reworded" (same claim, different words) or "stronger" (a stronger verb or a rounder number than the piece states). Say "stronger" whenever it is.
- A "stronger" line gives in "honest" a wording that keeps exactly to what its pieces state, in the posting's terms where they fit; Kris chooses between them. Otherwise "honest" is null.
- "why" says in a few plain words why a line changed ("" when it didn't).
- "skills" lists skill pieces by their exact text, the ones the posting asks for first.
- "evidence" names, for each posting requirement (by its index in "requirements"), the pieces that back it; leave a requirement out when nothing does.
- "notes" explain the main choices in plain words, one per note.
- Write in the language given ("en" English, "bg" Bulgarian); tool names stay in Latin script.`;

const coachTurnInstructions = `You are the coach in Kris's setup interview: you check what was imported from old CVs, ask about gaps in the timeline, probe for skills Kris likely has but never wrote down, and collect standard answers. Answer as JSON matching the schema. Rules:
- You write down only what Kris said. Never add a skill, number, employer, title, date or result Kris didn't say. If Kris doesn't know, write nothing.
- "asked" is the question Kris just answered (its topic and the lines so far, Kris's answer last), or null when you only ask "next". "next" is the question after it, or null when nothing is left.
- "reply" is one or two short sentences on Kris's answer: say what you'll write down, or "" when you only ask.
- "ask" is one short, friendly question: a follow-up about the same topic (then "followUp": true; at most one follow-up per topic), otherwise the "next" question (or "" when "next" is null). A gap question names the months and the roles either side; a check question quotes what the source says (and each version when sources disagree).
- Each piece cites in "turn" the id of the line of Kris's it came from (only ids of lines with "who": "you"). To change an existing piece (the one being checked, a role either side of a gap), set "updates" to its id and give the whole new piece; otherwise "updates" is null. "role" is the id of the role or education entry an achievement or skill sits under, or null.
- An achievement is one sentence of at most 200 characters. Months are "YYYY-MM". A number keeps Kris's own wording ("about a third"); "numberSource" says where it comes from ("measured", "estimate", "told") or null when there's no number.
- "claim" is "stronger" when a piece says more than Kris did (a stronger verb, a rounder or more precise number); then "honest" is the wording that keeps to what Kris said. Otherwise "as-said" and "honest" null.
- For a standard question, "answer" is Kris's answer in short form, citing the line; otherwise null.`;

const writeLetterInstructions = `You write Kris's cover letter for one job posting, in Kris's own voice, as JSON matching the schema. Rules:
- Follow the voice rules given, and sound like the excerpts of Kris's writing (they show how Kris writes, not what to say).
- The body is about "words" words in three short paragraphs: open with the company's problem (not with Kris), then one concrete example from the pieces with its number, then what Kris wants to do in this role. Close in one sentence.
- Use only the pieces given and the CV's wording as given in "cv": never a stronger claim than the CV makes ("led 1 of 3" stays "led 1 of 3"). Never add a skill, tool, employer, number or date that isn't in the cited pieces.
- Name every gap in "gaps" honestly, in one sentence, as something Kris hasn't done yet and wants to learn. Never claim experience with it.
- No stock phrases: never "passionate", "excited to apply", "thrilled", "results-driven", "dynamic", "synergy", "I believe", "I think", "I feel", and no contact-me filler.
- Each sentence cites in "pieceIds" the pieces it relies on (none for a sentence about the company), and "forCompany" is true for a sentence written specifically for this company or posting.
- "greeting" is the salutation ("Dear Kestrel hiring team,"); "closing" is the sign-off ("Kind regards,"), without the name.
- With an "instruction", rewrite "previous" as asked, keeping everything else to these rules.
- Write in the language given ("en" English, "bg" Bulgarian); tool names stay in Latin script.`;

/** What each task sends: its instructions and the prompt built from its input. */
function promptOf(request: WriterRequest): { instructions: string; prompt: string } {
  switch (request.task) {
    case "draft-pieces":
      return { instructions: draftPiecesInstructions, prompt: `File: ${request.input.fileName}\n\n${request.input.text}` };
    case "learn-voice": {
      const { rules, removed, excerpts } = request.input;
      const known = rules.length ? rules.map((r) => `- ${r.id}: ${r.text} (${r.evidence})`).join("\n") : "(none yet)";
      const gone = removed.length ? removed.map((r) => `- ${r}`).join("\n") : "(none)";
      return { instructions: learnVoiceInstructions, prompt: `Known rules:\n${known}\n\nRemoved by Kris:\n${gone}\n\nExcerpts:\n\n${excerptLines(excerpts)}` };
    }
    case "tailor-cv":
      return { instructions: tailorCvInstructions, prompt: JSON.stringify(request.input) };
    case "coach-turn":
      return { instructions: coachTurnInstructions, prompt: JSON.stringify(request.input) };
    case "write-letter": {
      const { excerpts, ...rest } = request.input;
      return { instructions: writeLetterInstructions, prompt: `${JSON.stringify(rest)}\n\nExcerpts of Kris's writing:\n\n${excerptLines(excerpts)}` };
    }
  }
}

export function createOpenRouterWriter(options: OpenRouterWriterOptions): Writer {
  const { model, modelId } = openRouterModel(options);

  /** One schema-validated call. A failed call that was still billed throws with its `costUsd`. */
  async function write<T>(request: WriterRequest, schema: z.ZodType<T>, name: string, excerpts: SentExcerpt[] = []): Promise<Written<T>> {
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
      return { output: result.output, costUsd: billedUsd(result, MAX_OUTPUT_TOKENS), model: result.response.modelId || modelId, excerpts };
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
    learnVoice: (input) => write({ task: "learn-voice", input }, learnedVoiceSchema, "learned_voice", input.excerpts),
    tailorCv: (input) => write({ task: "tailor-cv", input }, tailoredCvSchema, "tailored_cv"),
    coachTurn: (input) => write({ task: "coach-turn", input }, coachTurnSchema, "coach_turn"),
    writeLetter: (input) => write({ task: "write-letter", input }, writtenLetterSchema, "cover_letter", input.excerpts),
  };
}
