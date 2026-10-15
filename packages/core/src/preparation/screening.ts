// Screening answers (ticket #66): the target posting's questions, from its form where the ATS
// publishes it (the Greenhouse and Ashby questions APIs), otherwise the standard questions most
// forms ask; and the pure rules behind each answer: form limits, trimming a bank answer to fit (only
// whole sentences are removed, so no fact is ever added), salary's suggestion from the bank's rule,
// and where the job was first seen. The package store (packages.ts) puts them together.
import { eurPer, perMonth } from "../fit/weights.ts";
import type { AnswerLanguage } from "./answers.ts";

/** How a form takes the answer: one line, a paragraph, or one of its options. */
export type QuestionType = "text" | "long-text" | "select";

/** A form's limit on an answer's length; null where it sets none. */
export interface AnswerLimit {
  words: number | null;
  chars: number | null;
}

export interface FormQuestion {
  /** The form's own field name ("question_31003"), or the standard question's key. */
  id: string;
  /** As the form asks it. */
  question: string;
  required: boolean;
  type: QuestionType;
  /** A select's options, in the form's order (empty otherwise). */
  options: string[];
  limit: AnswerLimit;
}

/** Where the questions came from: the target posting's own form, or the standard questions. */
export interface FormQuestions {
  from: "form" | "standard";
  questions: FormQuestion[];
  /** Why the form's questions couldn't be read, when the ATS publishes them; null otherwise. */
  problem: string | null;
}

export interface TargetPosting {
  url: string;
  site: string;
  source: { kind: string };
}

const noLimit: AnswerLimit = { words: null, chars: null };

/** Fields a package doesn't answer: Kris's name and contact details (filled from Profile) and the files. */
const filledElsewhere = new Set(["first_name", "last_name", "preferred_name", "email", "phone", "resume", "resume_text", "cover_letter", "cover_letter_text"]);

/** A limit the form states in its label or help ("Max 150 words", "up to 500 characters", "до 100 думи"). */
export function limitOf(...texts: (string | null | undefined)[]): AnswerLimit {
  const s = texts.filter(Boolean).join(" ").replace(/<[^>]+>/g, " ");
  const words = /(\d[\d,]*)\s*(?:words?|думи)/iu.exec(s);
  const chars = /(\d[\d,]*)\s*(?:characters?|chars?|символа|знака)/iu.exec(s);
  const n = (m: RegExpExecArray | null) => (m ? Number(m[1]!.replace(/,/g, "")) : null);
  return { words: n(words), chars: n(chars) };
}

// ---------------------------------------------------------------- the form's questions

interface GreenhouseQuestion {
  required?: boolean;
  label?: string;
  description?: string | null;
  fields?: { name?: string; type?: string; values?: { label?: string }[] }[];
}

/** A Greenhouse job's board and id from its link ("job-boards.greenhouse.io/kestrel/jobs/4410", or "?gh_jid=" on a board page). */
function greenhouseJob(url: string): { board: string; id: string } | null {
  const m = /greenhouse\.io\/(?:embed\/job_app\?for=)?([a-z0-9_-]+)\/jobs\/(\d+)/i.exec(url);
  if (m) return { board: m[1]!.toLowerCase(), id: m[2]! };
  const board = /greenhouse\.io\/([a-z0-9_-]+)/i.exec(url)?.[1];
  const id = /[?&]gh_jid=(\d+)/.exec(url)?.[1];
  return board && id ? { board: board.toLowerCase(), id } : null;
}

async function greenhouseQuestions(url: string, fetch: typeof globalThis.fetch): Promise<FormQuestion[] | null> {
  const job = greenhouseJob(url);
  if (!job) return null;
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${job.board}/jobs/${job.id}?questions=true`);
  if (!res.ok) throw new Error(`Greenhouse answered ${res.status}`);
  const body = (await res.json()) as { questions?: GreenhouseQuestion[] };
  if (!Array.isArray(body.questions)) throw new Error("Greenhouse sent no questions list");
  const out: FormQuestion[] = [];
  for (const q of body.questions) {
    const fields = (q.fields ?? []).filter((f) => f.type !== "input_file" && f.type !== "input_hidden");
    const field = fields[0];
    if (!field?.name || !q.label || filledElsewhere.has(field.name)) continue;
    const select = field.type === "multi_value_single_select" || field.type === "multi_value_multi_select";
    out.push({
      id: field.name,
      question: q.label.trim(),
      required: q.required === true,
      type: select ? "select" : field.type === "textarea" ? "long-text" : "text",
      options: select ? (field.values ?? []).map((v) => v.label?.trim() ?? "").filter(Boolean) : [],
      limit: limitOf(q.label, q.description),
    });
  }
  return out;
}

interface AshbyField {
  isRequired?: boolean;
  descriptionPlain?: string | null;
  field?: { path?: string; title?: string; type?: string; selectableValues?: { label?: string }[] | null };
}

/** An Ashby job's board and id from its link ("jobs.ashbyhq.com/kestrel/0b5f…"). */
function ashbyJob(url: string): { board: string; id: string } | null {
  const m = /jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i.exec(url);
  return m ? { board: decodeURIComponent(m[1]!), id: m[2]! } : null;
}

const ashbyQuery = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    applicationForm { sections { fieldEntries { ... on FormFieldEntry { isRequired descriptionPlain field } } } }
  }
}`;

/** Ashby's public job page reads its form from this endpoint; the same request, without a session. */
async function ashbyQuestions(url: string, fetch: typeof globalThis.fetch): Promise<FormQuestion[] | null> {
  const job = ashbyJob(url);
  if (!job) return null;
  const res = await fetch("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationName: "ApiJobPosting", variables: { organizationHostedJobsPageName: job.board, jobPostingId: job.id }, query: ashbyQuery }),
  });
  if (!res.ok) throw new Error(`Ashby answered ${res.status}`);
  const body = (await res.json()) as { data?: { jobPosting?: { applicationForm?: { sections?: { fieldEntries?: AshbyField[] }[] } } | null } };
  const sections = body.data?.jobPosting?.applicationForm?.sections;
  if (!Array.isArray(sections)) throw new Error("Ashby sent no application form");
  const ashbyOwn: Record<string, string> = { _systemfield_name: "first_name", _systemfield_email: "email", _systemfield_phone: "phone", _systemfield_resume: "resume" };
  const out: FormQuestion[] = [];
  for (const entry of sections.flatMap((s) => s.fieldEntries ?? [])) {
    const f = entry.field;
    if (!f?.path || !f.title || f.type === "File" || filledElsewhere.has(ashbyOwn[f.path] ?? f.path)) continue;
    const select = f.type === "ValueSelect" || f.type === "MultiValueSelect" || f.type === "Boolean";
    out.push({
      id: f.path,
      question: f.title.trim(),
      required: entry.isRequired === true,
      type: select ? "select" : f.type === "LongText" ? "long-text" : "text",
      options: f.type === "Boolean" ? ["Yes", "No"] : select ? (f.selectableValues ?? []).map((v) => v.label?.trim() ?? "").filter(Boolean) : [],
      limit: limitOf(f.title, entry.descriptionPlain),
    });
  }
  return out;
}

/** The questions most forms ask, for a posting whose form isn't published. */
export function standardQuestions(language: AnswerLanguage): FormQuestion[] {
  const q = (id: string, en: string, bg: string, type: QuestionType = "text", options: [string[], string[]] = [[], []]): FormQuestion => ({
    id, question: language === "bg" ? bg : en, required: true, type, options: language === "bg" ? options[1] : options[0], limit: noLimit,
  });
  return [
    q("standard:right-to-work", "Do you have the right to work in this country?", "Имате ли право да работите в тази държава?", "select", [["Yes", "No"], ["Да", "Не"]]),
    q("standard:notice-period", "What is your notice period?", "Какъв е срокът ви на предизвестие?"),
    q("standard:salary", "What are your salary expectations?", "Какви са очакванията ви за възнаграждение?"),
    q("standard:heard", "How did you hear about this job?", "Откъде научихте за позицията?"),
    q("standard:linkedin", "LinkedIn profile", "Профил в LinkedIn"),
  ];
}

/** The target posting's questions in the form's order; the standard ones when its ATS doesn't publish them or they can't be read. */
export async function formQuestions(target: TargetPosting | null, language: AnswerLanguage, fetch: typeof globalThis.fetch | undefined): Promise<FormQuestions> {
  const reader = target?.source.kind === "greenhouse" ? greenhouseQuestions : target?.source.kind === "ashby" ? ashbyQuestions : null;
  if (!target || !reader) return { from: "standard", questions: standardQuestions(language), problem: null };
  const name = target.source.kind === "greenhouse" ? "Greenhouse" : "Ashby";
  try {
    if (!fetch) throw new Error("this laptop can't reach it");
    const questions = await reader(target.url, fetch);
    if (questions === null) return { from: "standard", questions: standardQuestions(language), problem: `The ${name} link doesn't say which job it is, so its form couldn't be read.` };
    return { from: "form", questions, problem: null };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { from: "standard", questions: standardQuestions(language), problem: `${target.site}'s form couldn't be read (${why}).` };
  }
}

// ---------------------------------------------------------------- answers

/** Salary questions are never filled from the bank: Kris decides each time. */
export const isSalaryQuestion = (q: string) => /salary|compensation|pay expectation|remuneration|заплат|възнаграждени/iu.test(q);

/** "How did you hear about us?": answered from where the job was first seen. */
export const isHeardQuestion = (q: string) => /how did you (hear|find|learn)|where did you (hear|see|find)|откъде (научихте|разбрахте)/iu.test(q);

export const wordCount = (text: string) => (text.trim().match(/\S+/g) ?? []).length;

/** Whether a text fits the form's limit. */
export const fits = (text: string, limit: AnswerLimit) =>
  (limit.words === null || wordCount(text) <= limit.words) && (limit.chars === null || text.trim().length <= limit.chars);

/** Splits a paragraph into its sentences, keeping each one's own words. */
export function sentences(text: string): string[] {
  return (text.trim().match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/**
 * A bank answer adapted to the form's limit by removing whole sentences from its end, so nothing is
 * reworded and no fact added. Null when even its first sentence doesn't fit.
 */
export function trimToFit(text: string, limit: AnswerLimit): { text: string; removed: string[] } | null {
  const all = sentences(text);
  for (let keep = all.length; keep > 0; keep--) {
    const kept = all.slice(0, keep).join(" ");
    if (fits(kept, limit)) return { text: kept, removed: all.slice(keep) };
  }
  return null;
}

/** A posting's salary as Discover read it (a JobDetail's screening salary fits). */
export interface PostingSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: "year" | "month" | "day" | "hour" | null;
  basis: "gross" | "net" | "not-stated";
}

/** The posting's range a month in euros, or null when it isn't stated clearly. */
export function monthlyRange(s: PostingSalary | null | undefined): { low: number; high: number; basis: PostingSalary["basis"] } | null {
  if (!s) return null;
  const rate = s.currency ? eurPer[s.currency.toUpperCase()] : undefined;
  const factor = s.period ? perMonth[s.period] : undefined;
  const low = s.min ?? s.max;
  const high = s.max ?? s.min;
  if (rate == null || factor == null || low == null || high == null) return null;
  return { low: Math.round(low * rate * factor), high: Math.round(high * rate * factor), basis: s.basis };
}

export const euros = (n: number) => `€${Math.round(n).toLocaleString("en-GB")}`;

/**
 * The salary rule's suggestion: the middle of the range's upper half, to the nearest hundred, never
 * under the floor. Null when the posting states no range (the rule then has nothing to work from).
 */
export function suggestSalary(range: { low: number; high: number } | null, floor: number | null): number | null {
  if (!range) return null;
  const upper = Math.round((range.low + (range.high - range.low) * 0.75) / 100) * 100;
  return Math.max(upper, floor ?? 0);
}

/** Where a job was first seen, for "How did you hear about us?": the form's option, or the words for a text field. */
export function heardFrom(
  posting: { site: string; source: { label: string; category: string } } | undefined,
  options: string[],
): string | null {
  if (!posting) return null;
  const { label, category } = posting.source;
  const own = category === "ats";
  const candidates = own ? ["Company website", "Careers page", "Website", label] : category === "email" ? [label, "Job board"] : [posting.site, label, "Job board"];
  if (!options.length) return own ? "Company website" : category === "email" ? label : posting.site;
  for (const c of candidates) {
    const hit = options.find((o) => o.toLowerCase() === c.toLowerCase()) ?? options.find((o) => o.toLowerCase().includes(c.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}
