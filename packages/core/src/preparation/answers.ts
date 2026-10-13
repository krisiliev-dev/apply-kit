// The answer bank: Kris's reusable answers to standard and screening questions, each with the
// wordings portals use for it and a version per language. Packages draw on it, and the Apply
// extension fills portals from it (spec #51, "Contract for Apply"). Stored in SQLite (ADR 0003).
// Free of Node-only imports: the UI imports its constants as "@apply-kit/core/answers".
import type { Clock, SqlDatabase } from "../ports.ts";

export type AnswerLanguage = "en" | "bg";
export const answerLanguages: readonly AnswerLanguage[] = ["en", "bg"];

/** Standard: a question most forms ask (right to work, notice period, a link). Screening: one some jobs ask. */
export type AnswerCategory = "standard" | "screening";
export const answerCategories: readonly AnswerCategory[] = ["standard", "screening"];

/** What shape the answer takes in a form. A rule answer is worked out per job from its rule. */
export type AnswerKind = "text" | "yes-no" | "choice" | "number" | "date" | "rule";
export const answerKinds: readonly AnswerKind[] = ["text", "yes-no", "choice", "number", "date", "rule"];

/**
 * What happens when a form asks it. "fill": filled, and Kris still sees it before pressing Submit.
 * "ask": depends on the job (salary), so Kris decides each time; a rule may suggest a value.
 * "blank": a voluntary question (diversity) left empty; "Prefer not to say" only where a form requires an answer.
 */
export type AnswerMode = "fill" | "ask" | "blank";
export const answerModes: readonly AnswerMode[] = ["fill", "ask", "blank"];

/** A rule that suggests a value for an "ask each time" answer. */
export interface AnswerRule {
  /** In Kris's words: "Upper half of the posting's stated range, never under €2,000 a month". */
  text: string;
  /** The rule's numbers, for whoever applies it (the screening-answers step, Apply). */
  params: SalaryRule | null;
}

/** Salary: aim for the upper half of a range the posting states, never under the floor. */
export interface SalaryRule {
  kind: "salary";
  take: "upper-half";
  /** Gross per month; null for no floor. */
  floor: number | null;
  currency: "EUR";
}

/** One way a form phrases the question, in the language it is written in. */
export interface Wording {
  text: string;
  language: AnswerLanguage;
}

/** Where an answer came from: Profile, setup, a package, or a portal Apply filled (with the job). */
export interface AnswerSource {
  /** "Added in Profile", "From your contact details", "Halden Systems Workday form". */
  from: string;
  jobId: string | null;
  portal: string | null;
}

/** An answer Kris changed in a portal, waiting for "keep new or old". */
export interface PortalEdit {
  language: AnswerLanguage;
  /** What Kris typed in the portal. */
  text: string;
  /** What the bank had when the edit was recorded. */
  before: string;
  /** The portal, as Kris would name it: "Halden Systems Workday form". */
  portal: string;
  jobId: string | null;
  at: string;
}

export interface Answer {
  id: string;
  /** The question as Kris names it: "Notice period". */
  question: string;
  /** Other ways forms ask it, each in its language. */
  wordings: Wording[];
  /** The answer per language; a missing language is never filled silently. */
  versions: Partial<Record<AnswerLanguage, string>>;
  category: AnswerCategory;
  kind: AnswerKind;
  mode: AnswerMode;
  rule: AnswerRule | null;
  source: AnswerSource;
  useCount: number;
  lastUsedAt: string | null;
  /** A portal edit waiting for Kris (a needs-you item in Profile), or null. */
  portalEdit: PortalEdit | null;
  createdAt: string;
  updatedAt: string;
}

/** A new answer (no id) or an edit of one (its id). Wordings are plain text; their language is read from the script. */
export interface AnswerInput {
  id?: string;
  question: string;
  wordings?: string[];
  versions?: Partial<Record<AnswerLanguage, string>>;
  category: AnswerCategory;
  kind?: AnswerKind;
  mode?: AnswerMode;
  rule?: AnswerRule | null;
}

/** How a new answer came to be. Apply passes the job and portal; the Profile form leaves it out. */
export interface AnswerOrigin {
  from: string;
  jobId?: string | null;
  portal?: string | null;
}

export type AnswerField = "question" | "wordings" | "en" | "bg" | "kind" | "mode" | "rule";

export interface AnswerProblem {
  field: AnswerField;
  message: string;
}

export type SaveAnswerResult = { saved: true; answer: Answer } | { saved: false; problems: AnswerProblem[] };

/**
 * What to do with a question a form asks. Only "fill" carries a value: "ask each time" and "leave
 * blank" answers are never returned as values, and neither is a version in another language.
 */
export type AnswerFill =
  | { action: "fill"; value: string }
  /** Kris decides for this job; the rule, if any, suggests a value. */
  | { action: "ask"; rule: AnswerRule | null }
  /** Leave the field empty; `whenRequired` ("Prefer not to say") only if the form won't go on without one. */
  | { action: "leave-blank"; whenRequired: string | null }
  /** The bank has the answer only in other languages: draft a translation for Kris to review. */
  | { action: "no-version"; languages: AnswerLanguage[] };

export interface AnswerMatch {
  answerId: string;
  question: string;
  /** The question or wording that matched. */
  matched: string;
  /** 1 when the wording is the same (ignoring case and punctuation); less for a close wording. */
  confidence: number;
  fill: AnswerFill;
}

/** One change in an answer's life, newest first in the history. */
export interface AnswerChange {
  at: string;
  /** "created"; "changed" (a version's text, in Profile or kept from a portal); "kept-old" (a portal's version turned down). */
  event: "created" | "changed" | "kept-old";
  /** Where it happened: "Added in Profile", "Profile", "Halden Systems Workday form". */
  where: string;
  language: AnswerLanguage | null;
  /** The version before, and after (or the one turned down). */
  before: string | null;
  after: string | null;
}

/** What Apply reports when Kris changes a filled answer in a portal. */
export interface PortalEditInput {
  language: AnswerLanguage;
  text: string;
  portal: string;
  jobId?: string | null;
}

export interface AnswerQuery {
  category?: AnswerCategory;
  /** Answers neither used nor added in the last 90 days. */
  notUsedIn90Days?: boolean;
  /** Matches the question, its wordings and its versions, ignoring case. */
  search?: string;
  /** From 1. */
  page?: number;
  pageSize?: number;
}

export interface AnswerList {
  /** This page, standard answers first, then screening, each in the order they were added. */
  answers: Answer[];
  /** Answers matching the filters and search, over every page. */
  total: number;
  page: number;
  pageSize: number;
  /** Among answers matching the search, for the filter's counts. */
  counts: { all: number; standard: number; screening: number; notUsedIn90Days: number };
  /** Every answer with a portal edit waiting for "keep new or old", whatever the filters. */
  portalEdits: Answer[];
}

export const answerPageSize = 10;
const STALE_MS = 90 * 24 * 3600_000;

const handSource: AnswerSource = { from: "Added in Profile", jobId: null, portal: null };
const CYRILLIC = /\p{Script=Cyrillic}/u;
export const languageOf = (text: string): AnswerLanguage => (CYRILLIC.test(text) ? "bg" : "en");

/** Below this, a close wording isn't taken as the same question. */
export const minMatchConfidence = 0.6;

export interface AnswerStore {
  save(input: AnswerInput, origin?: AnswerOrigin): SaveAnswerResult;
  get(id: string): Answer | null;
  remove(id: string): boolean;
  list(query?: AnswerQuery): AnswerList;
  find(question: string, language: AnswerLanguage): AnswerMatch | null;
  history(id: string): AnswerChange[];
  recordUse(id: string): void;
  recordPortalEdit(id: string, edit: PortalEditInput): boolean;
  resolvePortalEdit(id: string, keep: "keep-new" | "keep-old"): Answer | null;
  /** Portal edits waiting for Kris. */
  needsYou(): number;
}

export function createAnswerStore({ db, clock }: { db: SqlDatabase; clock: Clock }): AnswerStore {
  const rowToAnswer = (r: Record<string, unknown>): Answer => ({
    id: String(r.id),
    question: String(r.question),
    wordings: JSON.parse(String(r.wordings)) as Wording[],
    versions: JSON.parse(String(r.versions)) as Answer["versions"],
    category: r.category as AnswerCategory,
    kind: r.kind as AnswerKind,
    mode: r.mode as AnswerMode,
    rule: r.rule == null ? null : (JSON.parse(String(r.rule)) as AnswerRule),
    source: JSON.parse(String(r.source)) as AnswerSource,
    useCount: Number(r.use_count),
    lastUsedAt: r.last_used_at == null ? null : String(r.last_used_at),
    portalEdit: r.portal_edit == null ? null : (JSON.parse(String(r.portal_edit)) as PortalEdit),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  });

  const get = (id: string) => {
    const r = db.prepare("SELECT * FROM answer WHERE id = ?").get(id);
    return r ? rowToAnswer(r) : null;
  };
  const all = () => db.prepare("SELECT * FROM answer ORDER BY rowid").all().map(rowToAnswer);

  function write(a: Answer) {
    db.prepare(
      `INSERT INTO answer (id, question, wordings, versions, category, kind, mode, rule, source, use_count, last_used_at, portal_edit, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET question = excluded.question, wordings = excluded.wordings, versions = excluded.versions,
         category = excluded.category, kind = excluded.kind, mode = excluded.mode, rule = excluded.rule,
         use_count = excluded.use_count, last_used_at = excluded.last_used_at, portal_edit = excluded.portal_edit,
         updated_at = excluded.updated_at`,
    ).run(
      a.id, a.question, JSON.stringify(a.wordings), JSON.stringify(a.versions), a.category, a.kind, a.mode,
      a.rule ? JSON.stringify(a.rule) : null, JSON.stringify(a.source), a.useCount, a.lastUsedAt,
      a.portalEdit ? JSON.stringify(a.portalEdit) : null, a.createdAt, a.updatedAt,
    );
  }

  function note(answerId: string, change: Omit<AnswerChange, "at">) {
    db.prepare("INSERT INTO answer_history (answer_id, at, detail) VALUES (?, ?, ?)").run(answerId, clock.now().toISOString(), JSON.stringify(change));
  }

  function history(id: string): AnswerChange[] {
    return db.prepare("SELECT at, detail FROM answer_history WHERE answer_id = ? ORDER BY id DESC").all(id)
      .map((r) => ({ at: String(r.at), ...(JSON.parse(String(r.detail)) as Omit<AnswerChange, "at">) }));
  }

  function save(input: AnswerInput, origin?: AnswerOrigin): SaveAnswerResult {
    const before = input.id ? get(input.id) : null;
    if (input.id && !before) return { saved: false, problems: [{ field: "question", message: "This answer no longer exists. It may have been deleted." }] };
    const now = clock.now().toISOString();
    const answer: Answer = {
      id: before?.id ?? `answer:${crypto.randomUUID()}`,
      question: input.question.trim(),
      wordings: cleanWordings(input.wordings ?? []),
      versions: cleanVersions(input.versions ?? {}),
      category: input.category,
      kind: input.kind ?? "text",
      mode: input.mode ?? "fill",
      rule: input.rule ?? null,
      source: before?.source ?? (origin ? { from: origin.from, jobId: origin.jobId ?? null, portal: origin.portal ?? null } : handSource),
      useCount: before?.useCount ?? 0,
      lastUsedAt: before?.lastUsedAt ?? null,
      portalEdit: before?.portalEdit ?? null,
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
    };
    const problems = [...check(answer), ...clashes(answer, all().filter((a) => a.id !== answer.id))];
    if (problems.length > 0) return { saved: false, problems };
    write(answer);
    if (!before) note(answer.id, { event: "created", where: answer.source.from, language: null, before: null, after: null });
    else {
      for (const l of answerLanguages) {
        const [was, now] = [before.versions[l] ?? null, answer.versions[l] ?? null];
        if (was !== now) note(answer.id, { event: "changed", where: "Profile", language: l, before: was, after: now });
      }
    }
    return { saved: true, answer };
  }

  function recordUse(id: string) {
    db.prepare("UPDATE answer SET use_count = use_count + 1, last_used_at = ? WHERE id = ?").run(clock.now().toISOString(), id);
  }

  function recordPortalEdit(id: string, edit: PortalEditInput): boolean {
    const a = get(id);
    const text = edit.text.trim();
    const before = a?.versions[edit.language] ?? "";
    if (!a || !text || text === before) return false;
    // A newer edit replaces one still waiting: Kris compares the bank with what he typed last.
    const portalEdit: PortalEdit = { language: edit.language, text, before, portal: edit.portal.trim(), jobId: edit.jobId ?? null, at: clock.now().toISOString() };
    db.prepare("UPDATE answer SET portal_edit = ? WHERE id = ?").run(JSON.stringify(portalEdit), id);
    return true;
  }

  function resolvePortalEdit(id: string, keep: "keep-new" | "keep-old"): Answer | null {
    const a = get(id);
    if (!a?.portalEdit) return a;
    const e = a.portalEdit;
    const now = clock.now().toISOString();
    const current = a.versions[e.language] ?? null;
    if (keep === "keep-new") {
      write({ ...a, versions: { ...a.versions, [e.language]: e.text }, portalEdit: null, updatedAt: now });
      note(id, { event: "changed", where: e.portal, language: e.language, before: current, after: e.text });
    } else {
      write({ ...a, portalEdit: null });
      note(id, { event: "kept-old", where: e.portal, language: e.language, before: current, after: e.text });
    }
    return get(id);
  }

  function remove(id: string): boolean {
    if (!get(id)) return false;
    db.prepare("DELETE FROM answer_history WHERE answer_id = ?").run(id);
    db.prepare("DELETE FROM answer WHERE id = ?").run(id);
    return true;
  }

  function list(query: AnswerQuery = {}): AnswerList {
    const answers = all().sort((a, b) => answerCategories.indexOf(a.category) - answerCategories.indexOf(b.category));
    const staleBefore = clock.now().getTime() - STALE_MS;
    const stale = (a: Answer) => new Date(a.lastUsedAt ?? a.createdAt).getTime() < staleBefore;
    const q = query.search?.trim().toLowerCase();
    const matching = answers.filter((a) => !q || [a.question, ...a.wordings.map((w) => w.text), ...Object.values(a.versions)].some((s) => s.toLowerCase().includes(q)));
    const shown = matching.filter((a) => (!query.category || a.category === query.category) && (!query.notUsedIn90Days || stale(a)));
    const pageSize = Math.max(1, Math.floor(query.pageSize ?? answerPageSize));
    const page = Math.max(1, Math.floor(query.page ?? 1));
    return {
      answers: shown.slice((page - 1) * pageSize, page * pageSize),
      total: shown.length,
      page,
      pageSize,
      counts: {
        all: matching.length,
        standard: matching.filter((a) => a.category === "standard").length,
        screening: matching.filter((a) => a.category === "screening").length,
        notUsedIn90Days: matching.filter(stale).length,
      },
      portalEdits: answers.filter((a) => a.portalEdit),
    };
  }

  const needsYou = () => Number(db.prepare("SELECT COUNT(*) AS n FROM answer WHERE portal_edit IS NOT NULL").get()?.n ?? 0);

  function find(question: string, language: AnswerLanguage): AnswerMatch | null {
    const asked = words(question);
    let best: { answer: Answer; matched: string; confidence: number } | null = null;
    for (const answer of all()) {
      for (const phrase of [answer.question, ...answer.wordings.map((w) => w.text)]) {
        const confidence = similarity(asked, words(phrase));
        if (confidence >= minMatchConfidence && (!best || confidence > best.confidence)) best = { answer, matched: phrase, confidence };
      }
    }
    if (!best) return null;
    const { answer, matched, confidence } = best;
    return { answerId: answer.id, question: answer.question, matched, confidence, fill: fillFor(answer, language) };
  }

  return { save, get, remove, list, find, history, recordUse, recordPortalEdit, resolvePortalEdit, needsYou };
}

/** Questions a cover letter answers: written fresh for each job, never stored. */
const LETTER_STYLE = /^\s*(why|защо)\b.*\b(company|us|here|role|position|job|team|join|work|apply|applying|interested|this|нас|компания|компанията|фирмата|позиция|позицията|ролята|кандидатствате|работите)\b/iu;

/** What every answer needs before it can be saved. */
function check(a: Answer): AnswerProblem[] {
  const problems: AnswerProblem[] = [];
  const say = (field: AnswerField, message: string) => problems.push({ field, message });
  if (!a.question) say("question", "Give the question, as you'd name it.");
  else if (LETTER_STYLE.test(a.question)) {
    say("question", "Questions like this are answered in the cover letter's words, written fresh for each job, so they aren't stored.");
  }
  if (a.mode === "fill" && answerLanguages.every((l) => !a.versions[l])) {
    say("en", "Give the answer in English or Bulgarian, or choose \"Ask me each time\" or \"Leave it blank\".");
  }
  for (const l of answerLanguages) {
    const v = a.versions[l];
    if (!v) continue;
    if (a.kind === "number" && !/^-?\d+([.,]\d+)?$/.test(v)) say(l, "A number answer is a number, like 3.");
    if (a.kind === "yes-no" && !(l === "en" ? /^(yes|no)$/i : /^(да|не)$/iu).test(v)) {
      say(l, l === "en" ? "A yes/no answer is \"Yes\" or \"No\"." : "A yes/no answer is \"Да\" or \"Не\".");
    }
  }
  const floor = a.rule?.params?.floor;
  if (floor != null && !(Number.isFinite(floor) && floor >= 0)) say("rule", "The floor is a monthly amount in euros, 0 or more.");
  return problems;
}

/** A question or wording another answer already uses would make finding answers ambiguous. */
function clashes(a: Answer, others: Answer[]): AnswerProblem[] {
  const owner = new Map<string, Answer>();
  for (const o of others) for (const p of [o.question, ...o.wordings.map((w) => w.text)]) owner.set(normalise(p), o);
  const problems: AnswerProblem[] = [];
  const q = owner.get(normalise(a.question));
  if (a.question && q) problems.push({ field: "question", message: `"${q.question}" is already in your answer bank, or matches its wordings. Edit that answer instead.` });
  for (const w of a.wordings) {
    const o = owner.get(normalise(w.text));
    if (o) problems.push({ field: "wordings", message: `"${w.text}" already finds your answer to "${o.question}". Add it there, or remove it here.` });
  }
  return problems;
}

function fillFor(a: Answer, language: AnswerLanguage): AnswerFill {
  if (a.mode === "ask") return { action: "ask", rule: a.rule };
  if (a.mode === "blank") return { action: "leave-blank", whenRequired: a.versions[language] ?? null };
  const value = a.versions[language];
  if (value) return { action: "fill", value };
  return { action: "no-version", languages: answerLanguages.filter((l) => a.versions[l]) };
}

function cleanWordings(list: string[]): Wording[] {
  const seen = new Set<string>();
  return list.map((w) => w.trim()).filter((w) => w && !seen.has(normalise(w)) && seen.add(normalise(w)))
    .map((text) => ({ text, language: languageOf(text) }));
}

function cleanVersions(v: Partial<Record<AnswerLanguage, string>>): Answer["versions"] {
  const out: Answer["versions"] = {};
  for (const l of answerLanguages) if (v[l]?.trim()) out[l] = v[l].trim();
  return out;
}

const normalise = (s: string) => words(s).join(" ");

/** Little words that don't tell questions apart, in English and Bulgarian. */
const stopWords = new Set([
  "a", "an", "the", "is", "are", "do", "does", "you", "your", "yours", "what", "which", "how", "to", "of", "in", "for", "on",
  "and", "or", "please", "any", "have", "has", "will", "would", "can", "could", "be", "with", "we", "us", "our", "i", "my",
  "if", "this", "that", "at", "as", "by",
  "и", "или", "на", "в", "във", "за", "с", "със", "от", "до", "по", "какъв", "каква", "какво", "какви", "кой", "коя", "кое",
  "ли", "е", "са", "ви", "вашият", "вашата", "вашето", "вашите", "си", "моля", "да", "се",
]);

/** The words that carry a question's meaning: lower case, letters and digits only, little words dropped. */
function words(s: string): string[] {
  const all = s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const meaningful = all.filter((w) => !stopWords.has(w));
  return meaningful.length > 0 ? meaningful : all;
}

/** How alike two questions are: 1 for the same words, else the share of words they have in common (Dice). */
function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.join(" ") === b.join(" ")) return 1;
  const setB = new Set(b);
  const common = new Set(a.filter((w) => setB.has(w))).size;
  return (2 * common) / (new Set(a).size + setB.size);
}
