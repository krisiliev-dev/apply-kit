// The tailoring evaluation (#69): tests riskiest assumption 3 (tailoring quality), as the extraction
// evaluation tested assumption 2. A writer runs over a fixed set of fictional profiles and real
// postings (English and Bulgarian) through the preparation engine, exactly as packages are written,
// and each package is reported: the lines the honesty validator refused (word for word), its flags,
// stock phrases, length, page fit and cost. The engine and the writers are passed in: the app passes
// the real writer (with the monthly cap), tests the fake one. Never part of the normal test run.
import { z } from "zod";
import type { PreparationEngine } from "../preparation/engine.ts";
import type { PackageJob, PackageView } from "../preparation/packages.ts";
import { validateCv, type RejectedLine } from "../preparation/honesty.ts";
import { stockPhrasesIn } from "../preparation/letter.ts";
import { fits, wordCount, type AnswerLimit } from "../preparation/screening.ts";
import type { ProfilePiece } from "../preparation/profile.ts";
import { packageRules } from "../preparation/packages.ts";
import { BULLET_MAX, SUMMARY_MAX } from "../documents/ats.ts";
import type { TailoredCv, TailorCvInput, Writer } from "../writing/writer.ts";
import type { EvaluationCase } from "./labels.ts";

const angle = z.enum(["developer", "security", "design"]);
const key = z.string().regex(/^[a-z0-9-]+$/);

/**
 * A profile of the evaluation set: a made-up person (`fictional`), their contact details, angle
 * summaries, profile pieces (each with a key other pieces name in `belongsTo`), standard answers for
 * the answer bank and voice samples (short texts in their own words). Every piece counts as confirmed.
 */
export const tailoringProfileSchema = z.object({
  id: key,
  /** True for a made-up person: the only kind allowed in the repository. */
  fictional: z.boolean(),
  /** Who they are, for the reader of the set. */
  about: z.string().optional(),
  contact: z.object({
    nameLatin: z.string().min(1),
    nameCyrillic: z.string(),
    email: z.string().email(),
    phone: z.string(),
    city: z.string(),
    country: z.string(),
    links: z.array(z.string().url()),
  }).strict(),
  angles: z.array(z.object({ angle, summary: z.string().min(1) }).strict()).min(1),
  pieces: z.array(z.object({
    key,
    kind: z.enum(["role", "achievement", "skill", "education"]),
    text: z.string(),
    entry: z.object({ title: z.string(), organisation: z.string(), city: z.string().nullable(), start: z.string(), end: z.string().nullable() }).strict().nullable().default(null),
    belongsTo: key.nullable().default(null),
    tags: z.array(z.string()).default([]),
    angles: z.array(angle).default([]),
    numberSource: z.enum(["measured", "estimate", "told"]).nullable().default(null),
  }).strict()).min(1),
  answers: z.array(z.object({
    question: z.string().min(1),
    wordings: z.array(z.string()).default([]),
    versions: z.object({ en: z.string().optional(), bg: z.string().optional() }).strict(),
    kind: z.enum(["text", "yes-no"]).default("text"),
  }).strict()).default([]),
  voice: z.array(z.object({ fileName: z.string().regex(/\.txt$/), text: z.string().min(1) }).strict()).default([]),
}).strict();
export type TailoringProfile = z.infer<typeof tailoringProfileSchema>;

/** A screening question the drafter answers in each package, with the form's limit. `{company}` is the posting's company. */
export const tailoringQuestionSchema = z.object({
  question: z.string().min(1),
  maxWords: z.number().int().positive().nullable().default(null),
  maxChars: z.number().int().positive().nullable().default(null),
}).strict();
export type TailoringQuestion = z.input<typeof tailoringQuestionSchema>;

/**
 * The set's case list (cases.json): which profile is tailored to which posting (by the posting's id
 * in the extraction set), and the screening questions each package answers (per language, unless a
 * case gives its own).
 */
export const tailoringSetSchema = z.object({
  questions: z.object({ en: z.array(tailoringQuestionSchema), bg: z.array(tailoringQuestionSchema) }).strict(),
  cases: z.array(z.object({
    id: key,
    profile: key,
    posting: key,
    questions: z.array(tailoringQuestionSchema).optional(),
    notes: z.string().optional(),
  }).strict()).min(1),
}).strict();
export type TailoringSet = z.infer<typeof tailoringSetSchema>;

/** One case, resolved: the profile, the posting (its labelled requirements stand in for the extractor's) and the questions. */
export interface TailoringCase {
  id: string;
  profile: TailoringProfile;
  posting: EvaluationCase;
  questions: TailoringQuestion[];
}

/** A writer under evaluation, by the model it is set to. */
export interface TailoringModel {
  model: string;
  writer: Writer;
}

/** A fresh preparation engine for one package: its own empty database, writing with this writer within this budget (USD). */
export interface TailoringEngine {
  preparation: PreparationEngine;
  /** The engine's clock, for years of experience. */
  now(): Date;
}

export interface TailoringOptions {
  cases: TailoringCase[];
  /** One model for the report; two for the blind comparison too. */
  models: TailoringModel[];
  engine(writer: Writer, budgetUsd: number): TailoringEngine;
  /** What is left of the budget for this run, asked before each package. */
  leftUsd(): number;
  /** Called after each package, with what it cost. */
  onProgress?: (done: number, total: number, result: PackageResult) => void;
}

export interface FlagResult {
  kind: string;
  title: string;
  detail: string;
}

export interface StockPhrase {
  phrase: string;
  /** "Cover letter", "CV summary", "Bullet under Northwind Bank", "Answer: Why Kestrel Payments?". */
  in: string;
  text: string;
}

export interface AnswerResult {
  question: string;
  drafted: boolean;
  /** The answer, or why the drafter didn't answer. */
  text: string;
  words: number;
  /** "120 words", "500 characters", or null when the form sets none. */
  limit: string | null;
  overLimit: boolean;
}

/** What one package came to, as the report shows it. */
export interface PackageResult {
  caseId: string;
  profile: string;
  posting: string;
  /** "Security Engineer at Kestrel Payments". */
  job: string;
  language: "en" | "bg";
  /** The model under evaluation, and the one that answered (as the provider reports it). */
  model: string;
  answeredBy: string | null;
  /** written: the package settled (some parts may still have failed). failed: it couldn't start or broke. */
  status: "written" | "failed";
  error: string | null;
  /** Parts the writer didn't write (failed after the engine's retry, or the budget), and why. The ATS check waits for approval, so it isn't one. */
  missing: { part: string; state: string; why: string }[];
  /** Every draft line the honesty validator refused, word for word. */
  rejected: RejectedLine[];
  /** Stronger wordings held back for Kris's decision. */
  heldBack: number;
  flags: FlagResult[];
  stock: StockPhrase[];
  cv: {
    pages: number;
    linesOnPage2: number;
    summary: string | null;
    summaryWords: number;
    /** The CV's lines as tailored: summary, then each role's bullets under its heading. */
    roles: { heading: string; bullets: string[] }[];
    skills: string[];
    /** Bullets over the ATS check's length (160 characters) and a summary over 400. */
    tooLong: string[];
  } | null;
  letter: {
    text: string;
    words: number;
    target: number;
    pages: number | null;
    /** The letter's checks that didn't pass: problems stop Approve, warnings are advice. */
    checks: { id: string; state: "problem" | "warning"; label: string; detail: string | null }[];
  } | null;
  answers: AnswerResult[];
  costUsd: number;
}

export interface ModelSummary {
  model: string;
  packages: number;
  written: number;
  /** Parts not written (failed, or the budget). */
  missingParts: number;
  rejected: number;
  /** Refusals by what the draft did, e.g. names a skill, a number, a role. */
  rejectedBy: Record<string, number>;
  heldBack: number;
  flags: Record<string, number>;
  stockPhrases: number;
  letterProblems: number;
  cvOnOnePage: number;
  lettersNearTarget: number;
  letters: number;
  answersOverLimit: number;
  answers: number;
  costUsd: number;
}

export interface TailoringReport {
  models: string[];
  packages: PackageResult[];
  summaries: ModelSummary[];
  costUsd: number;
}

/** The posting as a Job the package is for: its labelled requirements stand in for the extractor's reading. */
export function jobOf(c: TailoringCase): PackageJob {
  const p = c.posting;
  const e = p.expected;
  return {
    id: `eval-${c.id}`,
    title: p.input.title,
    titleTranslation: null,
    company: p.input.company,
    location: p.input.location,
    packageLanguage: e.language === "bg" ? "bg" : "en",
    closed: null,
    reading: { state: "read" },
    requirements: [
      ...e.requirements.map((r) => ({ text: r.text, kind: r.kind })),
      ...e.certificates.map((x) => ({ text: x.name, kind: x.kind, category: "certificate" as const })),
    ],
    screening: { salary: e.salary },
    postings: [{
      id: "posting", site: new URL(p.source.url).hostname, url: p.source.url,
      source: { name: p.input.company, kind: p.source.kind, label: p.source.kind, category: "ats" },
    }],
    target: { postingId: "posting" },
  };
}

/** A cautious estimate for one package: the CV's prompt (the largest) for the CV, the letter and each answer, plus voice learning. */
export function estimatePackageUsd(c: TailoringCase, writer: Writer): number {
  const input: TailorCvInput = {
    posting: { title: c.posting.input.title, company: c.posting.input.company, requirements: c.posting.expected.requirements.map((r) => r.text) },
    language: c.posting.expected.language === "bg" ? "bg" : "en",
    angle: { label: c.profile.angles[0]!.angle, summary: c.profile.angles[0]!.summary },
    pieces: c.profile.pieces.map((p) => ({ id: p.key, kind: p.kind, text: p.text, entry: p.entry, belongsTo: p.belongsTo, tags: p.tags, numberSource: p.numberSource })),
  };
  const calls = 2 + packageRules.draftsExpected + c.questions.length + (c.profile.voice.length ? 1 : 0);
  return writer.estimateCostUsd({ task: "tailor-cv", input }) * calls;
}

/** A writer that passes every call through and keeps what the CV tailoring returned, and which model answered. */
function recording(writer: Writer) {
  const seen = { cv: null as TailoredCv | null, model: null as string | null };
  const keep = <T extends { model: string }>(w: T) => { seen.model ??= w.model; return w; };
  const wrapped: Writer = {
    estimateCostUsd: (r) => writer.estimateCostUsd(r),
    draftPieces: (i) => writer.draftPieces(i).then(keep),
    learnVoice: (i) => writer.learnVoice(i).then(keep),
    tailorCv: (i) => writer.tailorCv(i).then((w) => { seen.cv = w.output; return keep(w); }),
    coachTurn: (i) => writer.coachTurn(i).then(keep),
    writeLetter: (i) => writer.writeLetter(i).then(keep),
    draftAnswer: (i) => writer.draftAnswer(i).then(keep),
  };
  return { writer: wrapped, seen };
}

/** Puts the profile into the engine: contact, pieces (confirmed), angles, answers and voice samples. */
async function seed(preparation: PreparationEngine, profile: TailoringProfile): Promise<ProfilePiece[]> {
  const contact = preparation.saveContact(profile.contact);
  if (!contact.saved) throw new Error(`${profile.id}: contact refused: ${contact.problems.map((p) => p.message).join("; ")}`);
  const ids = new Map<string, string>();
  const pieces: ProfilePiece[] = [];
  // Roles and education first, so achievements can sit under them.
  const order = [...profile.pieces].sort((a, b) => Number(a.belongsTo !== null) - Number(b.belongsTo !== null));
  for (const p of order) {
    const belongsTo = p.belongsTo === null ? null : ids.get(p.belongsTo);
    if (belongsTo === undefined) throw new Error(`${profile.id}: ${p.key} belongs to ${p.belongsTo}, which isn't a piece`);
    const r = preparation.savePiece({ kind: p.kind, text: p.text, entry: p.entry, belongsTo, tags: p.tags, angles: p.angles, numberSource: p.numberSource });
    if (!r.saved) throw new Error(`${profile.id}: piece ${p.key} refused: ${r.problems.map((x) => x.message).join("; ")}`);
    ids.set(p.key, r.piece.id);
    pieces.push(r.piece);
  }
  for (const a of profile.angles) {
    const r = preparation.saveAngle({ angle: a.angle, summary: a.summary });
    if (!r.saved) throw new Error(`${profile.id}: angle ${a.angle} refused: ${r.problems.map((x) => x.message).join("; ")}`);
  }
  for (const a of profile.answers) {
    const r = preparation.saveAnswer({ question: a.question, wordings: a.wordings, versions: a.versions, category: "standard", kind: a.kind });
    if (!r.saved) throw new Error(`${profile.id}: answer "${a.question}" refused: ${r.problems.map((x) => x.message).join("; ")}`);
  }
  if (profile.voice.length) {
    await preparation.addVoiceSamples(profile.voice.map((v) => ({ fileName: v.fileName, bytes: new TextEncoder().encode(v.text) })));
    await preparation.learnVoice();
  }
  return pieces;
}

const limitText = (l: AnswerLimit) => (l.words ? `${l.words} words` : l.chars ? `${l.chars} characters` : null);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function writePackage(c: TailoringCase, m: TailoringModel, options: TailoringOptions): Promise<PackageResult> {
  const job = jobOf(c);
  const language = job.packageLanguage;
  const base: PackageResult = {
    caseId: c.id, profile: c.profile.id, posting: c.posting.id, job: `${job.title} at ${job.company}`, language, model: m.model,
    answeredBy: null, status: "failed", error: null, missing: [], rejected: [], heldBack: 0, flags: [], stock: [], cv: null, letter: null, answers: [], costUsd: 0,
  };
  const rec = recording(m.writer);
  const { preparation, now } = options.engine(rec.writer, Math.max(0, options.leftUsd()));
  const spent = () => preparation.budget().spentUsd;
  try {
    const pieces = await seed(preparation, c.profile);
    const started = preparation.startPackage(job);
    if (!started.started) return { ...base, error: started.reason, costUsd: spent() };
    const view = (await preparation.packageSettled(started.package.id))!;
    const answers: AnswerResult[] = [];
    for (const q of c.questions) {
      const question = q.question.replace(/\{company\}/g, job.company);
      const limit: AnswerLimit = { words: q.maxWords ?? null, chars: q.maxChars ?? null };
      const r = await preparation.draftAnswer(view.id, { question, maxWords: limit.words, maxChars: limit.chars });
      answers.push(r.drafted
        ? { question, drafted: true, text: r.text, words: wordCount(r.text), limit: limitText(limit), overLimit: !fits(r.text, limit) }
        : { question, drafted: false, text: r.reason, words: 0, limit: limitText(limit), overLimit: false });
    }
    return { ...base, ...resultOf(view, answers, rec.seen.cv, { pieces, alsoNamed: [job.company], now: now() }), answeredBy: rec.seen.model, status: "written", costUsd: spent() };
  } catch (err) {
    return { ...base, answeredBy: rec.seen.model, error: message(err), costUsd: spent() };
  }
}

/** What the report needs from a settled package. */
function resultOf(
  view: PackageView, asked: AnswerResult[], cv: TailoredCv | null, honesty: Parameters<typeof validateCv>[1],
): Pick<PackageResult, "missing" | "rejected" | "heldBack" | "flags" | "stock" | "cv" | "letter" | "answers"> {
  const language = view.language;
  const missing = view.parts.filter((p) => p.state === "failed" || p.state === "not-written" || p.state === "stopped").map((p) => ({ part: p.label, state: p.state, why: p.error ?? p.what }));
  const validated = cv ? validateCv(cv, honesty) : null;
  const v = view.cvVersion;
  const stock: StockPhrase[] = [];
  const scan = (where: string, text: string) => { for (const phrase of stockPhrasesIn(text, language)) stock.push({ phrase, in: where, text }); };

  const roles = v?.roles.map((r) => ({ heading: r.heading, bullets: r.bullets.map((b) => b.text) })) ?? [];
  const summary = v?.summary?.text ?? null;
  if (summary) scan("CV summary", summary);
  for (const r of roles) for (const b of r.bullets) scan(`Bullet under ${r.heading}`, b);
  const cvResult: PackageResult["cv"] = v && view.cv ? {
    pages: view.cv.pages,
    linesOnPage2: v.fit.linesOnPage2,
    summary,
    summaryWords: summary ? wordCount(summary) : 0,
    roles,
    skills: v.skills.map((s) => s.text),
    tooLong: [
      ...(summary && summary.length > SUMMARY_MAX ? [`Summary: ${summary.length} characters`] : []),
      ...roles.flatMap((r) => r.bullets.filter((b) => b.length > BULLET_MAX).map((b) => `${r.heading}: "${b}" (${b.length} characters)`)),
    ],
  } : null;

  const l = view.letter;
  if (l) for (const s of l.paragraphs.flat()) scan("Cover letter", s.text);
  const letter: PackageResult["letter"] = l ? {
    text: l.text, words: l.words, target: l.target, pages: l.file?.pages ?? null,
    checks: l.checks.filter((c): c is typeof c & { state: "problem" | "warning" } => c.state !== "ok").map((c) => ({ id: c.id, state: c.state, label: c.label, detail: c.detail })),
  } : null;

  // The form's answers the package drafted (not the bank's own words), then the case's questions.
  const formAnswers: AnswerResult[] = (view.answers?.questions ?? [])
    .filter((a) => (a.origin === "new" && a.pieces.length > 0) || a.origin === "adapted" || a.origin === "translated" || (a.needsYou && /fail|budget|unsafe|long/i.test(a.note)))
    .map((a) => ({ question: a.question, drafted: !a.needsYou, text: a.needsYou ? a.note : a.text, words: a.words, limit: limitText(a.limit), overLimit: !a.needsYou && !fits(a.text, a.limit) }));
  const answers = [...formAnswers, ...asked];
  for (const a of answers) if (a.drafted) scan(`Answer: ${a.question}`, a.text);

  return {
    missing,
    rejected: validated?.rejected ?? [],
    heldBack: validated?.heldBack ?? 0,
    flags: (v?.flags ?? []).map((f) => ({ kind: f.kind, title: f.title, detail: f.detail })),
    stock, cv: cvResult, letter, answers,
  };
}

/** The share of letters within a fifth of their target length counts as "near the target". */
const nearTarget = (l: NonNullable<PackageResult["letter"]>) => Math.abs(l.words - l.target) <= l.target / 5;

/** What a refusal was about, from its problem's words. */
function refusalKind(problem: string): string {
  if (problem.startsWith("names")) return "names something not in the profile";
  if (problem.startsWith("says")) return "a number its piece doesn't back";
  if (/role|changes the/.test(problem)) return "a role or its facts";
  if (problem.startsWith("lists a skill")) return "a skill not in the profile";
  return "cites no confirmed piece";
}

export function summarise(model: string, packages: PackageResult[]): ModelSummary {
  const mine = packages.filter((p) => p.model === model);
  const count = <T>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((n, x) => ({ ...n, [f(x)]: (n[f(x)] ?? 0) + 1 }), {});
  const letters = mine.flatMap((p) => (p.letter ? [p.letter] : []));
  const answers = mine.flatMap((p) => p.answers.filter((a) => a.drafted));
  return {
    model,
    packages: mine.length,
    written: mine.filter((p) => p.status === "written").length,
    missingParts: mine.reduce((n, p) => n + p.missing.length, 0),
    rejected: mine.reduce((n, p) => n + p.rejected.length, 0),
    rejectedBy: count(mine.flatMap((p) => p.rejected.flatMap((r) => r.problems)), refusalKind),
    heldBack: mine.reduce((n, p) => n + p.heldBack, 0),
    flags: count(mine.flatMap((p) => p.flags), (f) => f.kind),
    stockPhrases: mine.reduce((n, p) => n + p.stock.length, 0),
    letterProblems: letters.reduce((n, l) => n + l.checks.filter((c) => c.state === "problem").length, 0),
    cvOnOnePage: mine.filter((p) => p.cv?.pages === 1).length,
    lettersNearTarget: letters.filter(nearTarget).length,
    letters: letters.length,
    answersOverLimit: answers.filter((a) => a.overLimit).length,
    answers: answers.length,
    costUsd: mine.reduce((n, p) => n + p.costUsd, 0),
  };
}

/** Writes every case's package with every model, one at a time, and reports them. */
export async function runTailoringEvaluation(options: TailoringOptions): Promise<TailoringReport> {
  const packages: PackageResult[] = [];
  const total = options.cases.length * options.models.length;
  for (const c of options.cases) {
    for (const m of options.models) {
      const r = await writePackage(c, m, options);
      packages.push(r);
      options.onProgress?.(packages.length, total, r);
    }
  }
  const models = options.models.map((m) => m.model);
  return { models, packages, summaries: models.map((m) => summarise(m, packages)), costUsd: packages.reduce((n, p) => n + p.costUsd, 0) };
}
