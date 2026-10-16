// Voice (ticket #59): samples of Kris's own writing, and the readable voice rules the writer learns
// from them and from Kris's edits to drafts. Samples stay whole on this laptop (the file in the file
// store, its text in the database); every call that carries Kris's writing sends at most
// VOICE_EXCERPT_WORDS words of it, and each call's excerpts are recorded so they can be shown.
import { docxText, fileTypeOf, pdfPlainText, plainText } from "./extract.ts";
import { isFileReferenced } from "./file-references.ts";
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

/** Kris's writing sent to the model in one call, as recorded: what it was for and every excerpt. */
export interface VoiceSend {
  id: string;
  at: string;
  /** "learn-voice", or what the draft was for (e.g. "cover-letter"). */
  purpose: string;
  language: VoiceLanguage | null;
  excerpts: SentExcerpt[];
  words: number;
}

/** What a draft asks for: its language, and what it's for (recorded with the excerpts, e.g. "cover-letter"). */
export interface VoiceContextRequest {
  /** Inspect excerpts to estimate a call without claiming they were sent. */
  record?: boolean;
  language: VoiceLanguage;
  purpose: string;
}

/**
 * What a draft sends to sound like Kris: the voice rules for its language and a few short excerpts of
 * Kris's writing (at most VOICE_EXCERPT_WORDS words in all). Already recorded under `id` when it's handed out.
 */
export interface VoiceContext {
  id: string;
  rules: { id: string; text: string }[];
  excerpts: SentExcerpt[];
}

/**
 * Kris changed a draft (a letter, a screening answer, a follow-up): what the draft said and what Kris
 * made of it. `source` names where the draft belongs (e.g. "package:<id>", "application:<id>").
 */
export interface VoiceEditInput {
  purpose: string;
  language: VoiceLanguage;
  before: string;
  after: string;
  source?: string | null;
}

/** How a learning run ended: everything read, the monthly cap reached, or a failed call (tried again next time). */
export interface VoiceLearning {
  calls: number;
  stopped: "done" | "budget" | "failed";
  message: string | null;
}

export interface VoiceStore {
  view(): VoiceView;
  add(files: VoiceSampleFile[]): Promise<VoiceSample[]>;
  learn(): Promise<VoiceLearning>;
  sends(): VoiceSend[];
  context(request: VoiceContextRequest): VoiceContext;
  removeRule(id: string): boolean;
  recordEdit(edit: VoiceEditInput): boolean;
  /**
   * Keeps Kris's latest changes to one draft as a single piece of evidence: `previous` (the id this
   * returned last time for the draft) is updated while it waits to be learned from; once learned, a
   * new edit starts from what was learned. Returns the id to pass next time (null when nothing is
   * recorded: learning paused, or the draft is back to what it was).
   */
  saveEdit(edit: VoiceEditInput, previous: string | null): string | null;
  /** Where an excerpt came from, in words: the sample's file name, or "An edit you made to a draft". */
  sourceLabel(source: string): string;
  setLearning(fromEdits: boolean): VoiceView;
  remove(id: string): Promise<boolean>;
  replace(id: string, file: VoiceSampleFile): Promise<VoiceSample | null>;
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

/** A text's sentences, paragraph by paragraph (a paragraph break always ends one). */
const sentences = (text: string) =>
  text.split(/\n\s*\n|\n/).flatMap((p) => p.split(/(?<=[.!?…])\s+/)).map((x) => x.trim()).filter((x) => wordCount(x) > 0);

/** The first `limit` words of a text. */
const firstWords = (s: string, limit: number) => s.split(/\s+/).filter(Boolean).slice(0, limit).join(" ");

/** A text cut into excerpts of whole sentences, each at most `limit` words (a longer sentence is cut short). */
function chunks(text: string, limit = VOICE_EXCERPT_WORDS): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let n = 0;
  for (const raw of sentences(text)) {
    const sentence = wordCount(raw) > limit ? firstWords(raw, limit) : raw;
    const w = wordCount(sentence);
    if (n + w > limit && current.length) {
      out.push(current.join(" "));
      current = [];
      n = 0;
    }
    current.push(sentence);
    n += w;
  }
  if (current.length) out.push(current.join(" "));
  return out;
}

/** Rules are the same rule when their words are (case, punctuation and spacing don't count). */
const ruleKey = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** One part of Kris's writing waiting to be learned from: part of a sample, or an edit to a draft. */
interface Unit {
  excerpt: SentExcerpt;
  words: number;
  /** Marks it learned once the call that sent it succeeds. */
  done: () => void;
}

/**
 * An edit as Kris's writing to learn from: only the sentences that changed, what the draft said and
 * what Kris wrote, within the word limit.
 */
function editExcerpt(before: string, after: string, limit = VOICE_EXCERPT_WORDS): string | null {
  const was = sentences(before);
  const now = sentences(after);
  let removed = was.filter((x) => !now.includes(x)).join(" ");
  let added = now.filter((x) => !was.includes(x)).join(" ");
  if (!removed && !added) return null;
  const room = limit - 2;
  if (wordCount(removed) + wordCount(added) > room) {
    const half = Math.floor(room / 2);
    const forAdded = Math.max(half, room - wordCount(removed));
    added = firstWords(added, forAdded);
    removed = firstWords(removed, room - wordCount(added));
  }
  return [removed && `Draft: ${removed}`, added && `Kris: ${added}`].filter(Boolean).join("\n");
}

export function createVoiceStore(deps: PreparationDeps): VoiceStore {
  const { db, clock } = deps;
  const now = () => clock.now().toISOString();
  db.prepare("INSERT OR IGNORE INTO voice_settings (id) VALUES (1)").run();
  const learnFromEdits = () => Number(db.prepare("SELECT learn_from_edits AS on_ FROM voice_settings WHERE id = 1").get()?.on_ ?? 1) === 1;

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

  async function add(files: VoiceSampleFile[], at?: number): Promise<VoiceSample[]> {
    const added: VoiceSample[] = [];
    for (const file of files) {
      const stored = await deps.files.put(file.bytes);
      const read = await readText(file);
      const id = `voice-sample:${crypto.randomUUID()}`;
      const position = at ?? Number(db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM voice_sample").get()?.p ?? 1);
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

  const rowToRule = (r: Record<string, unknown>): VoiceRule => ({
    id: String(r.id),
    text: String(r.text),
    evidence: String(r.evidence),
    language: (r.language ?? null) as VoiceLanguage | null,
    samples: (JSON.parse(String(r.samples)) as string[]).length,
    edits: Number(r.edits),
    learnedAt: String(r.updated_at),
  });
  const rowToSend = (r: Record<string, unknown>): VoiceSend => ({
    id: String(r.id),
    at: String(r.at),
    purpose: String(r.purpose),
    language: (r.language ?? null) as VoiceLanguage | null,
    excerpts: JSON.parse(String(r.excerpts)) as SentExcerpt[],
    words: Number(r.words),
  });

  /** Records what a call sends, before it's sent. */
  function recordSend(purpose: string, language: VoiceLanguage | null, excerpts: SentExcerpt[]): string {
    const id = `voice-send:${crypto.randomUUID()}`;
    const words = excerpts.reduce((n, e) => n + wordCount(e.text), 0);
    db.prepare("INSERT INTO voice_send (id, at, purpose, language, excerpts, words) VALUES (?, ?, ?, ?, ?, ?)").run(
      id, now(), purpose, language, JSON.stringify(excerpts), words,
    );
    return id;
  }

  /** Everything not yet learned from, in order: the samples' unread parts, then edits. */
  function waitingUnits(): Unit[] {
    const units: Unit[] = [];
    for (const r of db.prepare("SELECT id, text, learned_chunks FROM voice_sample WHERE text IS NOT NULL ORDER BY position").all()) {
      const parts = chunks(String(r.text));
      for (let i = Number(r.learned_chunks); i < parts.length; i++) {
        units.push({
          excerpt: { source: `sample:${String(r.id)}`, text: parts[i]! },
          words: wordCount(parts[i]!),
          done: () => db.prepare("UPDATE voice_sample SET learned_chunks = MAX(learned_chunks, ?) WHERE id = ?").run(i + 1, String(r.id)),
        });
      }
    }
    for (const r of db.prepare("SELECT id, before, after FROM voice_edit WHERE learned_at IS NULL ORDER BY at, rowid").all()) {
      const id = String(r.id);
      const markLearned = () => db.prepare("UPDATE voice_edit SET learned_at = ? WHERE id = ?").run(now(), id);
      const excerpt = editExcerpt(String(r.before), String(r.after));
      if (!excerpt) { markLearned(); continue; }
      units.push({ excerpt: { source: `edit:${id}`, text: excerpt }, words: wordCount(excerpt), done: markLearned });
    }
    return units;
  }

  /** What a source says about when its writing arrived: a sample's adding, or an edit's making. */
  function arrivedAt(source: string): string | null {
    const [kind, id] = [source.slice(0, source.indexOf(":")), source.slice(source.indexOf(":") + 1)];
    const row = kind === "sample"
      ? db.prepare("SELECT added_at AS at FROM voice_sample WHERE id = ?").get(id)
      : kind === "edit" ? db.prepare("SELECT at FROM voice_edit WHERE id = ?").get(id) : undefined;
    return row ? String(row.at) : null;
  }

  /** Adds the rules a call learned, or the evidence for ones already there. A removed rule comes back only on writing newer than its removal. */
  function applyLearned(learned: LearnedVoice, sent: SentExcerpt[]) {
    const sentSources = new Set(sent.map((e) => e.source));
    for (const rule of learned.rules) {
      const sources = [...new Set(rule.sources)].filter((x) => sentSources.has(x));
      const text = rule.text.trim();
      // A rule with nothing in this call to show it isn't learned from this call.
      if (!text || sources.length === 0) continue;
      const sampleIds = sources.filter((x) => x.startsWith("sample:")).map((x) => x.slice("sample:".length));
      const edits = sources.filter((x) => x.startsWith("edit:")).length;
      const existing =
        (rule.id ? db.prepare("SELECT * FROM voice_rule WHERE id = ? AND removed_at IS NULL").get(rule.id) : undefined) ??
        db.prepare("SELECT * FROM voice_rule WHERE key = ?").get(ruleKey(text));
      if (!existing) {
        db.prepare(
          `INSERT INTO voice_rule (id, key, text, evidence, language, samples, edits, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(`voice-rule:${crypto.randomUUID()}`, ruleKey(text), text, rule.evidence.trim(), rule.language, JSON.stringify(sampleIds), edits, now(), now());
        continue;
      }
      const removedAt = existing.removed_at == null ? null : String(existing.removed_at);
      if (removedAt && !sources.some((x) => (arrivedAt(x) ?? "") > removedAt)) continue;
      const samples = [...new Set([...(JSON.parse(String(existing.samples)) as string[]), ...sampleIds])];
      db.prepare("UPDATE voice_rule SET evidence = ?, language = ?, samples = ?, edits = edits + ?, updated_at = ?, removed_at = NULL WHERE id = ?").run(
        rule.evidence.trim() || String(existing.evidence), rule.language, JSON.stringify(samples), edits, now(), String(existing.id),
      );
    }
  }

  let running: Promise<VoiceLearning> | null = null;

  /** Learns from everything waiting, one call of at most VOICE_EXCERPT_WORDS words after another. */
  async function learnAll(): Promise<VoiceLearning> {
    let calls = 0;
    for (;;) {
      const batch: Unit[] = [];
      let n = 0;
      for (const unit of waitingUnits()) {
        if (n + unit.words > VOICE_EXCERPT_WORDS) break;
        batch.push(unit);
        n += unit.words;
      }
      if (batch.length === 0) return { calls, stopped: "done", message: null };
      const excerpts = batch.map((u) => u.excerpt);
      const input: VoiceLearningInput = {
        rules: db.prepare("SELECT * FROM voice_rule WHERE removed_at IS NULL ORDER BY created_at, rowid").all().map((r) => ({ id: String(r.id), text: String(r.text), evidence: String(r.evidence) })),
        removed: db.prepare("SELECT text FROM voice_rule WHERE removed_at IS NOT NULL ORDER BY removed_at").all().map((r) => String(r.text)),
        excerpts,
      };
      const estimateUsd = deps.writer.estimateCostUsd({ task: "learn-voice", input });
      try {
        const outcome = await deps.budget.call({ task: "learn-voice", estimateUsd }, () => {
          recordSend("learn-voice", null, excerpts);
          return deps.writer.learnVoice(input);
        });
        if (outcome.refused) return { calls, stopped: "budget", message: "This month's AI budget is used up; the voice learns the rest next month." };
        calls++;
        applyLearned(outcome.result.output, excerpts);
        for (const u of batch) u.done();
      } catch (err) {
        return { calls: calls + 1, stopped: "failed", message: `Learning the voice failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  }

  function learn(): Promise<VoiceLearning> {
    running ??= learnAll().finally(() => { running = null; });
    return running;
  }

  /**
   * Rules for the language, and excerpts from its readable samples (cover letters first): the opening
   * sentences of each, sharing the word limit between them.
   */
  function context({ language, purpose, record = true }: VoiceContextRequest): VoiceContext {
    const rules = db.prepare("SELECT id, text FROM voice_rule WHERE removed_at IS NULL AND (language IS NULL OR language = ?) ORDER BY created_at, rowid").all(language)
      .map((r) => ({ id: String(r.id), text: String(r.text) }));
    const samples = db.prepare(
      "SELECT id, text FROM voice_sample WHERE text IS NOT NULL AND language = ? ORDER BY CASE kind WHEN 'cover-letter' THEN 0 ELSE 1 END, position",
    ).all(language);
    const share = Math.max(40, Math.floor(VOICE_EXCERPT_WORDS / Math.max(1, samples.length)));
    const excerpts: SentExcerpt[] = [];
    let left = VOICE_EXCERPT_WORDS;
    for (const r of samples) {
      const allowed = Math.min(share, left);
      const taken: string[] = [];
      let n = 0;
      for (const sentence of sentences(String(r.text))) {
        const w = wordCount(sentence);
        if (n + w > allowed) break;
        taken.push(sentence);
        n += w;
      }
      if (taken.length === 0) continue;
      excerpts.push({ source: `sample:${String(r.id)}`, text: taken.join(" ") });
      left -= n;
      if (left <= 0) break;
    }
    return { id: record ? recordSend(purpose, language, excerpts) : "", rules, excerpts };
  }

  /** Takes a rule out of use; it doesn't come back unless writing newer than this shows it again. */
  function removeRule(id: string): boolean {
    if (!db.prepare("SELECT 1 AS x FROM voice_rule WHERE id = ? AND removed_at IS NULL").get(id)) return false;
    db.prepare("UPDATE voice_rule SET removed_at = ? WHERE id = ?").run(now(), id);
    return true;
  }

  /** Deletes a sample and, unless something else keeps the same bytes, its copy in the file store. Rules learned stay. */
  async function remove(id: string): Promise<boolean> {
    const row = db.prepare("SELECT sha256 FROM voice_sample WHERE id = ?").get(id);
    if (!row) return false;
    db.prepare("DELETE FROM voice_sample WHERE id = ?").run(id);
    const sha = String(row.sha256);
    if (!isFileReferenced(db, sha)) await deps.files.remove(sha);
    return true;
  }

  /** Replace: the new file takes the old one's place in the list. */
  async function replace(id: string, file: VoiceSampleFile): Promise<VoiceSample | null> {
    const row = db.prepare("SELECT position FROM voice_sample WHERE id = ?").get(id);
    if (!row) return null;
    await remove(id);
    return (await add([file], Number(row.position)))[0]!;
  }

  /** Keeps an edit to a draft as evidence, unless learning from edits is paused or nothing changed. */
  function recordEdit(edit: VoiceEditInput): boolean {
    if (!learnFromEdits() || !editExcerpt(edit.before, edit.after)) return false;
    db.prepare("INSERT INTO voice_edit (id, at, draft, language, source, before, after) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      `voice-edit:${crypto.randomUUID()}`, now(), edit.purpose, edit.language, edit.source ?? null, edit.before, edit.after,
    );
    return true;
  }

  function saveEdit(edit: VoiceEditInput, previous: string | null): string | null {
    const old = previous ? db.prepare("SELECT * FROM voice_edit WHERE id = ?").get(previous) : undefined;
    if (!learnFromEdits()) return old ? previous : null;
    if (old && old.learned_at == null) {
      if (!editExcerpt(String(old.before), edit.after)) {
        db.prepare("DELETE FROM voice_edit WHERE id = ?").run(previous);
        return null;
      }
      db.prepare("UPDATE voice_edit SET after = ?, at = ? WHERE id = ?").run(edit.after, now(), previous);
      return previous;
    }
    // What was learned already is the new starting point.
    const before = old ? String(old.after) : edit.before;
    if (!editExcerpt(before, edit.after)) return old ? previous : null;
    const id = `voice-edit:${crypto.randomUUID()}`;
    db.prepare("INSERT INTO voice_edit (id, at, draft, language, source, before, after) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      id, now(), edit.purpose, edit.language, edit.source ?? null, before, edit.after,
    );
    return id;
  }

  function sourceLabel(source: string): string {
    if (source.startsWith("sample:")) {
      const r = db.prepare("SELECT file_name FROM voice_sample WHERE id = ?").get(source.slice("sample:".length));
      return r ? String(r.file_name) : "A sample you removed since";
    }
    return "An edit you made to a draft";
  }

  function setLearning(fromEdits: boolean): VoiceView {
    db.prepare("UPDATE voice_settings SET learn_from_edits = ? WHERE id = 1").run(fromEdits ? 1 : 0);
    return view();
  }

  function view(): VoiceView {
    const samples = db.prepare("SELECT * FROM voice_sample ORDER BY position").all().map(rowToSample);
    const edits = db.prepare(
      "SELECT COUNT(*) AS total, COUNT(DISTINCT source) AS sources, SUM(CASE WHEN learned_at IS NULL THEN 1 ELSE 0 END) AS waiting FROM voice_edit",
    ).get()!;
    return {
      samples,
      rules: db.prepare("SELECT * FROM voice_rule WHERE removed_at IS NULL ORDER BY created_at, rowid").all().map(rowToRule),
      learnedFrom: { samples: samples.filter((s) => !s.problem).length, edits: Number(edits.total) - Number(edits.waiting ?? 0) },
      edits: { total: Number(edits.total), sources: Number(edits.sources), waiting: Number(edits.waiting ?? 0) },
      learnFromEdits: learnFromEdits(),
      updating: running !== null,
    };
  }

  return {
    view,
    add: (files) => add(files),
    learn,
    context,
    removeRule,
    recordEdit,
    saveEdit,
    sourceLabel,
    setLearning,
    remove,
    replace,
    sends: () => db.prepare("SELECT * FROM voice_send ORDER BY at DESC, rowid DESC").all().map(rowToSend),
  };
}
