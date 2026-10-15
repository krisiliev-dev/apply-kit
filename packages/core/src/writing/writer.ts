// The writer: Prepare's AI seam, as the extractor is Discover's. One method per writing task, each
// returning schema-validated output, what the call cost and the excerpts it sent. The service
// implements it with OpenRouter (the only place that talks to the model for Prepare); tests pass a
// fake that returns recorded outputs. Later tickets add a method, an input and a schema per task.
import { z } from "zod";

/** Text taken from a file Kris imported: only this ever reaches the model, never the file itself. */
export interface ImportedText {
  /** The file's original name, so the model can tell CV versions apart. */
  fileName: string;
  text: string;
}

/**
 * Pieces drafted from imported text, each with the quote it came from (copied word for word), for
 * Kris to check. A role or education entry carries its facts (months as "YYYY-MM", or "YYYY" when the
 * text gives only the year); an achievement or skill names the role it sits under by its index in
 * this list. Every field is present (null when unknown), as structured output requires.
 */
export const draftedPiecesSchema = z.object({
  pieces: z.array(z.object({
    kind: z.enum(["role", "achievement", "skill", "education"]),
    /** The achievement or skill; a role's or education's description (may be empty). */
    text: z.string(),
    quote: z.string(),
    entry: z.object({
      title: z.string(),
      organisation: z.string(),
      city: z.string().nullable(),
      start: z.string(),
      end: z.string().nullable(),
    }).nullable(),
    /** Index (in `pieces`) of the role or education entry this piece belongs to. */
    role: z.number().int().nullable(),
  })),
});
export type DraftedPieces = z.infer<typeof draftedPiecesSchema>;

/**
 * What learning the voice sends: the rules so far (to reinforce or refine), the rules Kris removed
 * (not to suggest again from the same writing), and a few short excerpts of Kris's writing: parts
 * of samples and edits to drafts, never more than the excerpt limit in one call.
 */
export interface VoiceLearningInput {
  rules: { id: string; text: string; evidence: string }[];
  removed: string[];
  excerpts: SentExcerpt[];
}

/**
 * Voice rules the excerpts show: new ones (id null) or ones already there (their id) with updated
 * evidence. Each is a readable statement of how Kris writes, with its evidence in plain words, the
 * language it holds for (null when both), and the sources of the excerpts that show it.
 */
export const learnedVoiceSchema = z.object({
  rules: z.array(z.object({
    id: z.string().nullable(),
    text: z.string(),
    evidence: z.string(),
    language: z.enum(["en", "bg"]).nullable(),
    sources: z.array(z.string()),
  })),
});
export type LearnedVoice = z.infer<typeof learnedVoiceSchema>;

/** What a CV version is tailored from: the posting, the angle it starts from and the confirmed pieces it may use. */
export interface TailorCvInput {
  posting: { title: string; company: string; requirements: string[] };
  language: "en" | "bg";
  angle: { label: string; summary: string };
  /** Only confirmed pieces (and unconfirmed ones from this package); the model may cite nothing else. */
  pieces: { id: string; kind: string; text: string; entry: { title: string; organisation: string; start: string; end: string | null } | null }[];
}

/**
 * A tailored CV version: the summary and lines, each with the piece ids it relies on and how its
 * claim compares to them (as written, reworded, or stronger), plus tailoring notes. The honesty
 * validator (#63) checks every line before it is offered; until then the package shows the pieces as stored.
 */
export const tailoredCvSchema = z.object({
  summary: z.string(),
  lines: z.array(z.object({
    text: z.string(),
    pieceIds: z.array(z.string()),
    claim: z.enum(["as-written", "reworded", "stronger"]),
  })),
  notes: z.array(z.string()),
});
export type TailoredCv = z.infer<typeof tailoredCvSchema>;

/** Every writing task with its input, so one estimate covers them all. */
export type WriterRequest =
  | { task: "draft-pieces"; input: ImportedText }
  | { task: "learn-voice"; input: VoiceLearningInput }
  | { task: "tailor-cv"; input: TailorCvInput };

export type WriterTask = WriterRequest["task"];

/** A short piece of Kris's own writing sent with a call (voice excerpts), recorded so the Package can show it. */
export interface SentExcerpt {
  /** Where it comes from: "sample:<sample id>" or "edit:<edit id>". */
  source: string;
  text: string;
}

export interface Written<T> {
  output: T;
  costUsd: number;
  model: string;
  /** Every excerpt of Kris's own writing the call sent (none for tasks that send no voice). */
  excerpts: SentExcerpt[];
}

export interface Writer {
  /**
   * A cautious (high) estimate of what the call will cost in USD. The engine checks it against what
   * is left of the monthly budget before each call; it must not do any I/O.
   */
  estimateCostUsd(request: WriterRequest): number;
  /**
   * Each task throws on any failure (timeout, refusal, output that doesn't fit its schema). An error
   * may carry a numeric `costUsd` if the failed call was still billed.
   */
  draftPieces(input: ImportedText): Promise<Written<DraftedPieces>>;
  /** Learns voice rules from the excerpts; reports exactly the excerpts it sent. */
  learnVoice(input: VoiceLearningInput): Promise<Written<LearnedVoice>>;
  tailorCv(input: TailorCvInput): Promise<Written<TailoredCv>>;
}
