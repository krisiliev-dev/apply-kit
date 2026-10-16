// The real Track assistant: the same OpenRouter setup as extraction (DeepSeek V4.1 Flash, pinned
// non-China hosts that don't store or train on prompts, schema-validated output). Only the minimum
// of an email goes out: sender, subject, date and its text (trimmed); never attachments. A draft gets
// the Application, the posting's requirements, the Master profile pieces that bear on them and short
// voice excerpts (PRODUCT.md "Voice"); never the follow-up's id or any contact address.
import { generateText, Output } from "ai";
import { draftOutputSchema, emailClassificationSchema, prepSheetDraftSchema, type ClassifyInput, type DraftInput, type PrepSheetInput, type TrackAssistant } from "@apply-kit/core";
import { openRouterModel, rethrowBilledFailure } from "../openrouter.ts";

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
  Be honest: below 0.8 nothing changes without the job seeker confirming.
- interview: for an interview-invitation only (null otherwise): what the email states, never guessed.
  start and end as "YYYY-MM-DDTHH:mm" local to timeZone (resolve "Tuesday" from the email's Date), null when no time
  is fixed yet; timeZone as an IANA name ("CET" means "Europe/Berlin", "UK time" "Europe/London"), null when not stated;
  format "video", "phone" or "onsite" or null; place: the call link, phone number or address as written, or null;
  people: who it is with, as written ("Mara Ivanova, Engineering Manager"); round: which round or stage as written, or null;
  notes: anything else useful (what to prepare, time-zone remarks), or null.
- offer: for an offer only (null otherwise): what the email states, never guessed. baseSalary as written with its
  currency and period ("€3,100 gross / month"); startDate as "YYYY-MM-DD"; workPattern (remote, hybrid, on-site, shifts);
  contract (permanent, fixed-term, probation); other: anything else that matters, such as a deadline to answer. Null for
  anything the email doesn't state.`;

const prepInstructions = `You write a light interview prep sheet as JSON matching the schema, for a job seeker's application. Rules:
- facts: 3 to 6 short company facts. source "posting" only for what the posting text says, "notes" only for what the
  job seeker's notes say, "unverified" for anything else you know or believe. Never present a guess as from the posting.
- questions: 5 to 8 likely interview questions, each tied to one requirement from the posting (requirement as written).
- storyId: the id of one of the given stories that truly answers the question, or null when none does. Use only the ids
  given; never invent, merge or stretch a story. A null is fine and honest.
- Write in the given language.`;

const draftInstructions = `You draft a short email for a job seeker (a nudge after no reply, a thank-you note after an interview, a check-in when interviews have gone quiet, a withdrawal after accepting another offer, or a reply declining an offer), in their voice, as JSON {"body": "..."}. Rules:
- Body only: no subject, greeting, sign-off or name. The job seeker adds those in their own mail app.
- Concise and warm, never fawning. Plain, declarative sentences; direct tone.
- Mention exactly one concrete detail from the posting's requirements or the job seeker's notes; for a thank-you note,
  that detail is the topic they discussed in the interview, as given. A withdrawal or a decline needs no detail: thank
  them, say it plainly and keep the door open; never name the other company or the offer accepted.
- Facts about the job seeker come only from the Master profile pieces given. Never invent experience.
  Any number about them (counts, percentages, years) must be copied exactly from those pieces; if none fits, use no number.
- Never use these phrases: {banned}.
- Write in the language given (ISO 639-1; "bg" is Bulgarian).
- Match the job seeker's voice from the excerpts of their own writing, if any: their sentence length, word choice, warmth.
  Follow the rules given for how they write.
- Length: {min}-{max} words.`;

export interface TrackAssistantOptions {
  apiKey: string;
  model?: string;
  providers?: string[];
  fetch?: typeof fetch;
}

export function createOpenRouterTrackAssistant(options: TrackAssistantOptions): TrackAssistant {
  const { model, modelId } = openRouterModel(options);

  const promptFor = (input: ClassifyInput) =>
    `From: ${input.from}\nDate: ${input.receivedAt}\nSubject: ${input.subject}\n\n${input.text}`;
  /** Characters per token, low on purpose (Cyrillic tokenises densely) so the estimate stays high. */
  const tokens = (chars: number) => Math.ceil(chars / 2.5);
  const usd = (prompt: number, completion: number) => (prompt * PRICE.prompt + completion * PRICE.completion) / 1_000_000;

  const draftSystem = (input: DraftInput) => draftInstructions
    .replace("{banned}", input.banned.map((b) => `"${b}"`).join(", "))
    .replace("{min}", String(input.words.min)).replace("{max}", String(input.words.max));
  const draftPrompt = (input: DraftInput) => [
    input.kind === "thank-you"
      ? `Message: a thank-you note after an interview on ${input.since}${input.people?.length ? ` with ${input.people.join(", ")}` : ""}. One thing discussed: ${input.topic ?? "(not given)"}.`
      : input.kind === "check-in"
        ? `Message: a polite check-in, ${input.daysQuiet} days after the last interview (${input.since}) with no news.`
        : input.kind === "withdrawal"
          ? `Message: withdrawing from this process (now ${input.stage}) after accepting another offer; never name the other company. Applied ${input.since}.`
          : input.kind === "decline"
            ? `Message: declining their offer, graciously. Applied ${input.since}.`
            : `Message: a nudge after no reply, ${input.daysQuiet} days after ${input.stage === "applied" ? "applying" : "moving to screening"} (${input.since}).`,
    `Job: ${input.title} at ${input.company}. Language: ${input.language}.`,
    `Posting requirements:\n${input.requirements.map((r) => `- ${r}`).join("\n") || "- (not read)"}`,
    `The job seeker's notes:\n${input.notes.map((n) => `- ${n}`).join("\n") || "- (none)"}`,
    `Master profile pieces:\n${input.evidence.map((e) => `- ${e.text}`).join("\n") || "- (none: use no numbers about the job seeker)"}`,
    `Excerpts of the job seeker's own writing:\n${input.voice.map((v) => `> ${v}`).join("\n") || "> (none yet)"}`,
    `How the job seeker writes:\n${input.voiceRules.map((r) => `- ${r}`).join("\n") || "- (nothing learned yet)"}`,
  ].join("\n\n");
  const DRAFT_OUTPUT_TOKENS = 500;
  const prepPromptFor = (input: PrepSheetInput) => JSON.stringify({
    company: input.company, title: input.title, language: input.language, requirements: input.requirements, notes: input.notes,
    stories: input.stories.map((s) => ({ id: s.id, text: s.text })), posting: input.postingText,
  });
  const PREP_OUTPUT_TOKENS = 1_800;

  return {
    estimatePrepSheetUsd(input) {
      return usd(tokens(prepInstructions.length + prepPromptFor(input).length + 1_500), PREP_OUTPUT_TOKENS);
    },
    async buildPrepSheet(input) {
      const result = await generateText({
        model,
        instructions: prepInstructions,
        prompt: prepPromptFor(input),
        output: Output.object({ schema: prepSheetDraftSchema, name: "prep_sheet" }),
        temperature: 0.2,
        maxOutputTokens: PREP_OUTPUT_TOKENS,
        maxRetries: 1,
        timeout: TIMEOUT_MS * 2,
      }).catch((err: unknown) => rethrowBilledFailure(err, PREP_OUTPUT_TOKENS));
      const reported = (result.providerMetadata?.openrouter as { usage?: { cost?: unknown } } | undefined)?.usage?.cost;
      const costUsd = typeof reported === "number" && Number.isFinite(reported)
        ? reported
        : usd(result.usage.inputTokens ?? 0, result.usage.outputTokens ?? PREP_OUTPUT_TOKENS);
      return { sheet: result.output, costUsd, model: result.response.modelId || modelId };
    },
    estimateDraftUsd(input) {
      return usd(tokens(draftSystem(input).length + draftPrompt(input).length), DRAFT_OUTPUT_TOKENS);
    },
    async draft(input) {
      const result = await generateText({
        model,
        instructions: draftSystem(input),
        prompt: draftPrompt(input),
        output: Output.object({ schema: draftOutputSchema, name: "follow_up_draft" }),
        temperature: 0.4,
        maxOutputTokens: DRAFT_OUTPUT_TOKENS,
        maxRetries: 1,
        timeout: TIMEOUT_MS,
      }).catch((err: unknown) => rethrowBilledFailure(err, DRAFT_OUTPUT_TOKENS));
      const reported = (result.providerMetadata?.openrouter as { usage?: { cost?: unknown } } | undefined)?.usage?.cost;
      const costUsd = typeof reported === "number" && Number.isFinite(reported)
        ? reported
        : usd(result.usage.inputTokens ?? 0, result.usage.outputTokens ?? DRAFT_OUTPUT_TOKENS);
      return { draft: result.output, costUsd, model: result.response.modelId || modelId };
    },
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
      }).catch((err: unknown) => rethrowBilledFailure(err, MAX_OUTPUT_TOKENS));
      const reported = (result.providerMetadata?.openrouter as { usage?: { cost?: unknown } } | undefined)?.usage?.cost;
      const costUsd = typeof reported === "number" && Number.isFinite(reported)
        ? reported
        : usd(result.usage.inputTokens ?? 0, result.usage.outputTokens ?? MAX_OUTPUT_TOKENS);
      return { classification: result.output, costUsd, model: result.response.modelId || modelId };
    },
  };
}
