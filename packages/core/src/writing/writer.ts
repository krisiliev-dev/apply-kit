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
  pieces: {
    id: string; kind: string; text: string; entry: { title: string; organisation: string; start: string; end: string | null } | null;
    /** The role an achievement sits under: its bullets stay under that role. */
    belongsTo: string | null;
    tags: string[];
    numberSource: "measured" | "estimate" | "told" | null;
  }[];
}

/**
 * One line of a tailored CV: its words, the piece ids it relies on, how its claim compares to them,
 * and why it changed ("" when it didn't). A "stronger" line also gives the wording that keeps to
 * what its pieces state (`honest`), for Kris to choose instead; null otherwise.
 */
const tailoredLine = z.object({
  text: z.string(),
  pieceIds: z.array(z.string()),
  claim: z.enum(["as-written", "reworded", "stronger"]),
  why: z.string(),
  honest: z.string().nullable(),
});
export type TailoredLine = z.infer<typeof tailoredLine>;

/**
 * A tailored CV version: the summary; the roles (by their piece id, with the facts as the model
 * states them, so the honesty validator can hold them to the profile) and their bullets in CV order,
 * leaving out the less relevant ones; the skills in order (matching first); the pieces used as
 * evidence for each posting requirement (by its index); and tailoring notes. The honesty validator
 * (preparation/honesty.ts) checks every line before it is offered.
 */
export const tailoredCvSchema = z.object({
  summary: tailoredLine,
  roles: z.array(z.object({
    pieceId: z.string(),
    title: z.string(),
    employer: z.string(),
    /** "YYYY-MM" (or "YYYY"), as the profile gives them; end null while current. */
    start: z.string(),
    end: z.string().nullable(),
    bullets: z.array(tailoredLine),
    /** Why the bullets were reordered or shortened ("" when they weren't). */
    why: z.string(),
  })),
  skills: z.array(z.object({ text: z.string(), pieceIds: z.array(z.string()) })),
  evidence: z.array(z.object({ requirement: z.number().int(), pieceIds: z.array(z.string()) })),
  notes: z.array(z.string()),
});
export type TailoredCv = z.infer<typeof tailoredCvSchema>;

/** A role or education entry as the coach sees it: its id (to put a piece under it or update it) and its facts. */
export interface CoachEntry {
  id: string;
  kind: "role" | "education";
  title: string;
  organisation: string;
  start: string;
  end: string | null;
}

/**
 * What one coach-interview question is about, as the engine scoped it: an imported piece to check
 * (with each source's version when they disagree), a gap in the timeline (months as "YYYY-MM", the
 * roles either side), a skill Kris likely has but never wrote down (with the pieces that suggest
 * it), or a standard answer for the answer bank.
 */
export type CoachTopic =
  | { kind: "check"; piece: { id: string; kind: string; text: string; entry: Omit<CoachEntry, "id" | "kind"> | null; from: string; quote: string | null }; versions: { from: string; text: string }[] }
  | { kind: "gap"; from: string; to: string; months: number; before: CoachEntry | null; after: CoachEntry | null }
  | { kind: "skill"; angle: string; skill: string; suggestedBy: { id: string; text: string }[] }
  | { kind: "standard"; key: string; question: string };

/** A line of the interview: the coach's, or Kris's own words (each of Kris's has an id pieces cite). */
export interface CoachLine {
  id: string;
  who: "coach" | "you";
  text: string;
}

/**
 * One coach turn. `asked` is the question Kris just answered (its topic and its lines so far, Kris's
 * answer last), or null when the coach only asks `next`. `next` is the question after it, or null
 * when nothing is left. `entries` are the profile's roles and education, for placing pieces.
 */
export interface CoachTurnInput {
  asked: { topic: CoachTopic; lines: CoachLine[] } | null;
  next: CoachTopic | null;
  entries: CoachEntry[];
}

/**
 * The coach's turn: a short reply to Kris's answer (may be empty), then what it asks: a follow-up
 * about the same question (`followUp`) or the next question (empty when nothing is left). Pieces
 * and a standard answer are written only from Kris's own words, each citing the line it came from
 * (`turn`). A piece updates an existing one (`updates`, its id) or is new; `role` is the id of the
 * role or education it sits under. A claim stronger than what Kris said is marked "stronger", with
 * the wording that keeps to what Kris said (`honest`).
 */
export const coachTurnSchema = z.object({
  reply: z.string(),
  ask: z.string(),
  followUp: z.boolean(),
  pieces: z.array(z.object({
    turn: z.string(),
    updates: z.string().nullable(),
    kind: z.enum(["role", "achievement", "skill", "education"]),
    text: z.string(),
    entry: z.object({
      title: z.string(),
      organisation: z.string(),
      city: z.string().nullable(),
      start: z.string(),
      end: z.string().nullable(),
    }).nullable(),
    role: z.string().nullable(),
    tags: z.array(z.string()),
    angles: z.array(z.enum(["developer", "security", "design"])),
    numberSource: z.enum(["measured", "estimate", "told"]).nullable(),
    claim: z.enum(["as-said", "stronger"]),
    honest: z.string().nullable(),
  })),
  answer: z.object({ turn: z.string(), text: z.string() }).nullable(),
});
export type CoachTurn = z.infer<typeof coachTurnSchema>;

/** What a cover letter is written from (#65): the posting, the voice, the CV's decided wording and the gaps to name. */
export interface WriteLetterInput {
  posting: { title: string; company: string; requirements: string[] };
  language: "en" | "bg";
  /** About how many words the letter's body should have. */
  words: number;
  /** The voice rules for the language: how Kris writes. */
  voice: string[];
  /** A few short excerpts of Kris's own writing (at most the voice's excerpt limit), recorded as sent. */
  excerpts: SentExcerpt[];
  /** The CV as Kris decided it: its summary and lines, each with the pieces it relies on. The letter repeats this wording, never a stronger one. */
  cv: { summary: string | null; lines: { text: string; pieceIds: string[] }[] };
  /** Required items with no evidence that Kris chose to name in the letter, as something to learn. */
  gaps: string[];
  /** The pieces the letter may cite (as for the CV). */
  pieces: TailorCvInput["pieces"];
  /** Kris's instruction for a new draft ("Shorter"), and the draft it replaces; null for the first. */
  instruction: string | null;
  previous: string | null;
}

/**
 * A cover letter: the greeting, the body's paragraphs as sentences, and the closing (the template
 * signs the name under it). Each sentence says whether it was written for this company (`forCompany`,
 * highlighted for Kris to check first) and the piece ids it relies on (none for one that claims
 * nothing about Kris).
 */
export const writtenLetterSchema = z.object({
  greeting: z.string(),
  paragraphs: z.array(z.object({
    sentences: z.array(z.object({ text: z.string(), forCompany: z.boolean(), pieceIds: z.array(z.string()) })),
  })),
  closing: z.string(),
});
export type WrittenLetter = z.infer<typeof writtenLetterSchema>;

/** Every writing task with its input, so one estimate covers them all. */
export type WriterRequest =
  | { task: "draft-pieces"; input: ImportedText }
  | { task: "learn-voice"; input: VoiceLearningInput }
  | { task: "tailor-cv"; input: TailorCvInput }
  | { task: "coach-turn"; input: CoachTurnInput }
  | { task: "write-letter"; input: WriteLetterInput };

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
  /** The coach interview's next turn: what the coach says, and the pieces it writes from Kris's answer. */
  coachTurn(input: CoachTurnInput): Promise<Written<CoachTurn>>;
  /** A cover letter in Kris's voice; reports exactly the excerpts it sent. */
  writeLetter(input: WriteLetterInput): Promise<Written<WrittenLetter>>;
}
