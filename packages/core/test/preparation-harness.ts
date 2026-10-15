// Test harness for the preparation engine, like harness.ts for discovery: fake clock, in-memory
// database, in-memory file store, a fake writer returning recorded outputs, and fake renderer and
// PDF reader. The discovery engine is built on the same database, clock and AI budget, as the
// service does. Never live AI in tests.
import { createHash } from "node:crypto";
import {
  createAiBudget, createEngine, createPreparationEngine, formatRange, sectionTitles, draftedAnswerSchema, draftedPiecesSchema, tailoredCvSchema, writtenLetterSchema, type WriteLetterInput, type WrittenLetter, type DraftAnswerInput, type DraftedAnswer, type LearnedVoice, type VoiceLearningInput,
  type CoachTopic, type CoachTurn, type CoachTurnInput,
  type AiBudget, type DiscoveryEngine, type DocumentRenderer, type DraftedPieces, type EngineDeps, type FileStore,
  type ImportedText, type TailorCvInput, type TailoredCv, type PackageFolder, type PdfText, type PdfTextReader, type PreparationDeps, type PreparationEngine, type SentExcerpt, type TextRecognizer, type Writer, type WriterRequest,
} from "../src/index.ts";
import { fakeClock, fakeExtractor, fixtureFetch, loadFixture, memoryDb, type FakeClock, type FakeExtractor } from "./harness.ts";

/** What the writer drafted from a made-up CV (fictional person), checked in as a fixture. */
export const recordedDraftPieces: DraftedPieces = draftedPiecesSchema.parse(JSON.parse(loadFixture("writer-draft-pieces.json")));

/** What the writer tailored for a made-up security posting (fictional person), checked in as a fixture. */
export const recordedTailoredCv: TailoredCv = tailoredCvSchema.parse(JSON.parse(loadFixture("writer-tailor-cv.json")));

/** The cover letter the writer wrote for the same made-up posting (fictional person), checked in as a fixture. */
export const recordedLetter: WrittenLetter = writtenLetterSchema.parse(JSON.parse(loadFixture("writer-letter.json")));
/** What the writer drafted for a made-up incident question (fictional person), checked in as a fixture. */
export const recordedDraftAnswer: DraftedAnswer = draftedAnswerSchema.parse(JSON.parse(loadFixture("writer-draft-answer.json")));

/** What the writer drafted for "Why Kestrel Payments?": written for that company. */
export const recordedWhyAnswer: DraftedAnswer = draftedAnswerSchema.parse(JSON.parse(loadFixture("writer-draft-answer-why.json")));

/** The same three, as the writer wrote them for a Bulgarian package (#68): Bulgarian words, tool and employer names in Latin script. */
export const recordedTailoredCvBg: TailoredCv = tailoredCvSchema.parse(JSON.parse(loadFixture("writer-tailor-cv-bg.json")));
export const recordedLetterBg: WrittenLetter = writtenLetterSchema.parse(JSON.parse(loadFixture("writer-letter-bg.json")));
export const recordedDraftAnswerBg: DraftedAnswer = draftedAnswerSchema.parse(JSON.parse(loadFixture("writer-draft-answer-bg.json")));

/** A recorded output, an error to throw (it may carry a billed `costUsd`), or a function of the input (which may wait). */
type Recorded<I, O> = O | Error | ((input: I) => O | Error | Promise<O | Error>);

/** A recorded output per task. */
export interface RecordedOutputs {
  draftPieces?: Recorded<ImportedText, DraftedPieces>;
  tailorCv?: Recorded<TailorCvInput, TailoredCv>;
  /** The recorded letter by default (its placeholder piece ids are left as they are). */
  writeLetter?: Recorded<WriteLetterInput, WrittenLetter>;
  /** By default the coach asks the next question in plain words and writes nothing. */
  coachTurn?: Recorded<CoachTurnInput, CoachTurn>;
  /** The recorded incident answer by default. */
  draftAnswer?: Recorded<DraftAnswerInput, DraftedAnswer>;
  /** No new rules by default. */
  learnVoice?: LearnedVoice | Error | ((input: VoiceLearningInput) => LearnedVoice | Error | Promise<LearnedVoice | Error>);
}

export interface FakeWriter extends Writer {
  /** Every request the engine sent, in order (estimates aren't calls). */
  calls: WriterRequest[];
}

/**
 * A fake writer answering each task with its recorded output (the fixtures by default). Each call
 * costs `costUsd`, estimated at `estimateUsd`, and reports sending exactly the excerpts it was given.
 */
export function fakeWriter(
  recorded: RecordedOutputs = {},
  { costUsd = 0.002, estimateUsd = costUsd }: { costUsd?: number; estimateUsd?: number } = {},
): FakeWriter {
  const calls: WriterRequest[] = [];
  const answer = async <I, O>(given: Recorded<I, O> | undefined, fallback: O, input: I) => {
    const out = typeof given === "function" ? await (given as (input: I) => O | Error | Promise<O | Error>)(input) : (given ?? fallback);
    if (out instanceof Error) throw out;
    const excerpts = input && typeof input === "object" && "excerpts" in input ? (input as { excerpts: SentExcerpt[] }).excerpts : [];
    return { output: out, costUsd, model: "fake/writer", excerpts };
  };
  return {
    calls,
    estimateCostUsd: () => estimateUsd,
    async draftPieces(input) {
      calls.push({ task: "draft-pieces", input });
      return answer(recorded.draftPieces, recordedDraftPieces, input);
    },
    async learnVoice(input) {
      calls.push({ task: "learn-voice", input });
      return answer(recorded.learnVoice, { rules: [] }, input);
    },
    async tailorCv(input) {
      calls.push({ task: "tailor-cv", input });
      return answer(recorded.tailorCv, recordedTailoredCv, input);
    },
    async coachTurn(input) {
      calls.push({ task: "coach-turn", input });
      return answer(recorded.coachTurn, plainCoachTurn(input), input);
    },
    async writeLetter(input) {
      calls.push({ task: "write-letter", input });
      return answer(recorded.writeLetter, recordedLetter, input);
    },
    async draftAnswer(input) {
      calls.push({ task: "draft-answer", input });
      return answer(recorded.draftAnswer, recordedDraftAnswer, input);
    },
  };
}

/** What the fake coach asks about a topic, so a transcript reads like one. */
export function coachQuestion(topic: CoachTopic): string {
  switch (topic.kind) {
    case "check": return `Is this right: "${topic.piece.text || topic.piece.entry?.title}"?`;
    case "gap": return `Nothing is listed from ${topic.from} to ${topic.to}. What were you doing then?`;
    case "skill": return `Have you used ${topic.skill}?`;
    case "standard": return topic.question;
  }
}

/** The coach's turn when no output is recorded: a short reply, the next question, no pieces. */
export const plainCoachTurn = (input: CoachTurnInput): CoachTurn => ({
  reply: input.asked ? "Thanks." : "",
  ask: input.next ? coachQuestion(input.next) : "",
  followUp: false,
  pieces: [],
  answer: null,
});

/** The file store in memory: hash-named like the real one. */
export function memoryFileStore(): FileStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async put(bytes) {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      files.set(sha256, new Uint8Array(bytes));
      return { sha256, size: bytes.byteLength };
    },
    get: async (sha256) => files.get(sha256) ?? null,
    async remove(sha256) { files.delete(sha256); },
  };
}

/** The packages folder in memory, keyed by the path the real one would write. */
export function memoryPackageFolder(): PackageFolder & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const drafts = new Map<string, string>();
  return {
    files,
    async saveDraft(packageId, kind, fileName, bytes) {
      const folder = `packages/${packageId}/`;
      // A draft render replaces the previous draft of that document (ADR 0003).
      for (const [path] of files) if (path.startsWith(folder) && drafts.get(path) === kind) files.delete(path);
      const path = folder + fileName;
      files.set(path, new Uint8Array(bytes));
      drafts.set(path, kind);
      return { path };
    },
    async freeze(packageId, version, fileName, bytes) {
      const path = `packages/${packageId}/v${version}/${fileName}`;
      const frozen = files.get(path);
      if (frozen && Buffer.compare(frozen, bytes) !== 0) throw new Error(`Already frozen with other bytes: ${path}`);
      files.set(path, new Uint8Array(bytes));
      return { path, copy: `Packages/${fileName}` };
    },
    read: async (path) => files.get(path) ?? null,
  };
}
const fakePdfMagic = "%PDF-fake\n";

/**
 * A renderer whose "PDF" is a deterministic stand-in: the document's text layout, which the fake
 * reader reads back. `layout` decides the lines per page (one page holding the JSON content by default).
 */
export function fakeRenderer(layout: (doc: Parameters<DocumentRenderer["render"]>[0]) => PdfText = (doc) => ({
  pages: [{ lines: [doc.title, JSON.stringify(doc.content ?? null)] }],
})): DocumentRenderer {
  return {
    async render(doc) {
      const text = layout(doc);
      return { pdf: new TextEncoder().encode(fakePdfMagic + JSON.stringify(text)), pages: text.pages.length };
    },
  };
}

/** A PDF stand-in with a text layer holding these lines per page, as the fake reader reads it. */
export function fakePdf(pages: string[][]): Uint8Array {
  return new TextEncoder().encode(fakePdfMagic + JSON.stringify({ pages: pages.map((lines) => ({ lines })) }));
}

/** A scanned PDF: pages that are pictures, so the reader finds no text layer. */
export const scannedPdf = new TextEncoder().encode("%PDF-1.7\n% scanned pages, images only\n");

/** Text recognition that "reads" a scan as these lines (one page), recording each scan it was given. */
export function fakeRecognizer(lines: string[]): TextRecognizer & { scans: Uint8Array[] } {
  const scans: Uint8Array[] = [];
  return { scans, async recognise(pdf) { scans.push(pdf); return { pages: [{ lines }] }; } };
}

/** Reads the fake renderer's stand-ins back; any other bytes read as a PDF with no text layer (a scan). */
export function fakePdfReader(): PdfTextReader {
  return {
    async read(pdf) {
      const s = new TextDecoder().decode(pdf);
      return s.startsWith(fakePdfMagic) ? (JSON.parse(s.slice(fakePdfMagic.length)) as PdfText) : { pages: [{ lines: [] }] };
    },
  };
}

export interface TestPreparationOptions extends Partial<Omit<PreparationDeps, "budget" | "clock">> {
  /** The shared monthly cap in USD (default 10). */
  capUsd?: number;
  /** The discovery engine's own ports. */
  fetch?: typeof fetch;
  extractor?: FakeExtractor;
}

export interface TestPreparation {
  preparation: PreparationEngine;
  discovery: DiscoveryEngine;
  budget: AiBudget;
  clock: FakeClock;
  writer: Writer;
  files: FileStore;
}

/** Both engines on one in-memory database, fake clock and AI budget, as the service wires them. */
export function createTestPreparation(options: TestPreparationOptions = {}): TestPreparation {
  const { capUsd = 10, fetch = fixtureFetch(), extractor = fakeExtractor(), ...overrides } = options;
  const clock = fakeClock();
  const db = overrides.db ?? memoryDb();
  const budget = createAiBudget({ db, clock, capUsd });
  const deps: PreparationDeps = {
    db,
    clock,
    budget,
    writer: fakeWriter(),
    renderer: fakeRenderer(),
    pdfReader: fakePdfReader(),
    files: memoryFileStore(),
    packages: memoryPackageFolder(),
    fetch,
    ...overrides,
  };
  const discoveryDeps: EngineDeps = {
    db, clock, fetch, extractor, mailReader: { fetchSince: async () => [] }, budget, settings: deps.settings,
  };
  const discovery = createEngine(discoveryDeps);
  return { preparation: createPreparationEngine(deps), discovery, budget, clock, writer: deps.writer, files: deps.files };
}

/**
 * A renderer whose text reads back the way the real template prints (letterhead, section titles,
 * "Title · Employer, Place  Jan 2023 – present" lines, bullets, skills on one line), so the ATS
 * check passes on a well-formed CV. Letters print as the default stand-in.
 */
export function templateRenderer(): DocumentRenderer {
  return fakeRenderer((doc) => {
    if (doc.kind !== "cv") return { pages: [{ lines: [doc.title, JSON.stringify(doc.content)] }] };
    const c = doc.content;
    const h = c.letterhead;
    const titles = sectionTitles[doc.language];
    const lines = [h.name, h.headline, [h.location, h.email, h.phone, ...h.links].filter(Boolean).join(" · ")];
    if (c.summary.trim()) lines.push(titles.summary, c.summary);
    if (c.experience.length) {
      lines.push(titles.experience);
      for (const r of c.experience) lines.push(`${r.title} · ${r.employer}${r.place ? `, ${r.place}` : ""} ${formatRange(r.start, r.end, doc.language)}`, ...r.bullets);
    }
    if (c.skills.length) lines.push(titles.skills, c.skills.join(" · "));
    if (c.education.length) lines.push(titles.education, ...c.education.map((e) => `${e.degree} · ${e.school} ${formatRange(e.start, e.end, doc.language)}`));
    return { pages: [{ lines }] };
  });
}
