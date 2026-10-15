// Voice (ticket #59): samples of Kris's own writing, and the readable voice rules the writer learns
// from them and from Kris's edits to drafts. Samples stay whole on this laptop (the file in the file
// store, its text in the database); every call that carries Kris's writing sends at most
// VOICE_EXCERPT_WORDS words of it, and each call's excerpts are recorded so they can be shown.
import { docxText, fileTypeOf, pdfPlainText, plainText } from "./extract.ts";
import type { PreparationDeps } from "./ports.ts";
import type { LearnedVoice, SentExcerpt, VoiceLearningInput } from "../writing/writer.ts";
import { ZipError } from "./zip.ts";

/** The most words of Kris's own writing any one call sends (the spec's "about 150 words"). */
export const VOICE_EXCERPT_WORDS = 150;

export type VoiceLanguage = "en" | "bg";
export type VoiceSampleKind = "cover-letter" | "writing";

export interface VoiceSampleProblem {
  reason: "pages" | "old-word" | "scanned" | "damaged" | "empty" | "unsupported";
  /** Why, and how to fix it, in plain words. */
  message: string;
}

export interface VoiceSample {
  id: string;
  fileName: string;
  kind: VoiceSampleKind;
  /** Null when it couldn't be read. */
  language: VoiceLanguage | null;
  words: number;
  addedAt: string;
  /** Set when it couldn't be read: the reason and the fix (Replace). The other samples still count. */
  problem: VoiceSampleProblem | null;
}

export interface VoiceSampleFile {
  fileName: string;
  bytes: Uint8Array;
}

export interface VoiceRule {
  id: string;
  /** How Kris writes, e.g. "Opens with the company's problem, not with you". */
  text: string;
  /** What shows it, in plain words, e.g. "All 4 samples; you rewrote 6 openers". */
  evidence: string;
  /** The language it holds for; null when it holds for both. */
  language: VoiceLanguage | null;
  /** How many samples and edits showed it. */
  samples: number;
  edits: number;
  learnedAt: string;
}

export interface VoiceView {
  samples: VoiceSample[];
  /** The rules in use (removed ones aren't listed), oldest first. */
  rules: VoiceRule[];
  /** What the rules were learned from: readable samples, and edits learned from so far. */
  learnedFrom: { samples: number; edits: number };
  edits: {
    /** Edits to drafts recorded as evidence, and how many drafts' sources (packages, applications) they came from. */
    total: number;
    sources: number;
    /** Recorded but not yet learned from. */
    waiting: number;
  };
  /** Whether edits to drafts are recorded (the "Learn from my edits" switch). */
  learnFromEdits: boolean;
  /** Learning is running now (from new samples or edits). */
  updating: boolean;
}

export interface VoiceStore {
  view(): VoiceView;
  add(files: VoiceSampleFile[]): Promise<VoiceSample[]>;
}

const CYRILLIC = /\p{Script=Cyrillic}/gu;
const LATIN = /\p{Script=Latin}/gu;

/** Words as people count them: runs of letters or digits. */
export const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Bulgarian when Cyrillic letters outnumber Latin ones (a letter may name a company in either). */
const languageOf = (s: string): VoiceLanguage => ((s.match(CYRILLIC)?.length ?? 0) > (s.match(LATIN)?.length ?? 0) ? "bg" : "en");

const kindOf = (fileName: string, text: string): VoiceSampleKind =>
  /cover|letter|писмо/i.test(fileName) || /^\s*(dear|hello|hi|здравейте|уважаем)/i.test(text) ? "cover-letter" : "writing";

const stillCount = "the other samples still count.";
const problems = {
  pages: { reason: "pages", message: `Couldn't read a .pages file. Export it as PDF or DOCX from Pages; ${stillCount}` },
  "old-word": { reason: "old-word", message: `Couldn't read an old Word (.doc) file. Save it as DOCX or PDF; ${stillCount}` },
  scanned: { reason: "scanned", message: `This PDF is a scan, with no text to read. Export it again with its text, or as DOCX or TXT; ${stillCount}` },
  damaged: { reason: "damaged", message: `Couldn't open this file; it may be damaged. Save it again as PDF, DOCX or TXT; ${stillCount}` },
  empty: { reason: "empty", message: `There's no text in this file. Choose the file with your writing in it; ${stillCount}` },
} satisfies Record<string, VoiceSampleProblem>;
const unsupported = (fileName: string): VoiceSampleProblem => {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1];
  return { reason: "unsupported", message: `Couldn't read ${ext ? `a .${ext} file` : "this file"}. Use PDF, DOCX or TXT; ${stillCount}` };
};

export function createVoiceStore(deps: PreparationDeps): VoiceStore {
  const { db, clock } = deps;
  const now = () => clock.now().toISOString();

  const rowToSample = (r: Record<string, unknown>): VoiceSample => ({
    id: String(r.id),
    fileName: String(r.file_name),
    kind: r.kind as VoiceSampleKind,
    language: (r.language ?? null) as VoiceLanguage | null,
    words: Number(r.words),
    addedAt: String(r.added_at),
    problem: r.problem == null ? null : (JSON.parse(String(r.problem)) as VoiceSampleProblem),
  });

  /** A sample's text, read on this laptop, or why it can't be. */
  async function readText(file: VoiceSampleFile): Promise<{ text: string } | { problem: VoiceSampleProblem }> {
    const type = fileTypeOf(file.fileName, file.bytes);
    let text: string;
    try {
      switch (type) {
        case "txt": text = plainText(file.bytes); break;
        case "docx": text = docxText(file.bytes); break;
        case "pdf": {
          text = pdfPlainText(await deps.pdfReader.read(file.bytes));
          if (!text) return { problem: problems.scanned };
          break;
        }
        case "pages": return { problem: problems.pages };
        case "doc": return { problem: problems["old-word"] };
        default: return { problem: unsupported(file.fileName) };
      }
    } catch (err) {
      if (err instanceof ZipError || type === "pdf") return { problem: problems.damaged };
      throw err;
    }
    return wordCount(text) === 0 ? { problem: problems.empty } : { text };
  }

  async function add(files: VoiceSampleFile[]): Promise<VoiceSample[]> {
    const added: VoiceSample[] = [];
    for (const file of files) {
      const stored = await deps.files.put(file.bytes);
      const read = await readText(file);
      const id = `voice-sample:${crypto.randomUUID()}`;
      const position = Number(db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM voice_sample").get()?.p ?? 1);
      const t = "text" in read ? read.text : null;
      db.prepare(
        `INSERT INTO voice_sample (id, position, file_name, sha256, size, kind, language, words, text, problem, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, position, file.fileName, stored.sha256, stored.size, kindOf(file.fileName, t ?? ""),
        t === null ? null : languageOf(t), t === null ? 0 : wordCount(t), t, "problem" in read ? JSON.stringify(read.problem) : null, now(),
      );
      added.push(rowToSample(db.prepare("SELECT * FROM voice_sample WHERE id = ?").get(id)!));
    }
    return added;
  }

  function view(): VoiceView {
    const samples = db.prepare("SELECT * FROM voice_sample ORDER BY position").all().map(rowToSample);
    return {
      samples,
      rules: [],
      learnedFrom: { samples: samples.filter((s) => !s.problem).length, edits: 0 },
      edits: { total: 0, sources: 0, waiting: 0 },
      learnFromEdits: true,
      updating: false,
    };
  }

  return { view, add };
}

// Used by later slices.
export type { LearnedVoice, SentExcerpt, VoiceLearningInput };
