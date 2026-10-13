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

/** Every writing task with its input, so one estimate covers them all. */
export type WriterRequest =
  | { task: "draft-pieces"; input: ImportedText };

export type WriterTask = WriterRequest["task"];

/** A short piece of Kris's own writing sent with a call (voice excerpts), recorded so the Package can show it. */
export interface SentExcerpt {
  /** Where it comes from, e.g. a voice sample's id. */
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
}
