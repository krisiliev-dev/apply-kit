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
 * Kris to check. The import ticket (#54) adds the fields a profile piece needs.
 */
export const draftedPiecesSchema = z.object({
  pieces: z.array(z.object({
    kind: z.enum(["role", "achievement", "skill", "education"]),
    text: z.string(),
    quote: z.string(),
  })),
});
export type DraftedPieces = z.infer<typeof draftedPiecesSchema>;

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
  | { task: "tailor-cv"; input: TailorCvInput };

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
  tailorCv(input: TailorCvInput): Promise<Written<TailoredCv>>;
}
