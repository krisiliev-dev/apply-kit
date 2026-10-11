// Runs an extractor over the labelled evaluation set and scores it per fact type. The extractor
// and the budget are passed in: the app passes the real one (with the monthly cap), tests a fake.
import type { PostingFacts } from "../extraction/facts.ts";
import type { Extractor } from "../ports.ts";
import type { EvaluationCase } from "./labels.ts";
import { scoreCase, type CaseScore, type ListScore } from "./score.ts";

export interface EvaluationOptions {
  cases: EvaluationCase[];
  extractor: Extractor;
  /** The most this run may spend (USD). A posting whose estimate would cross it is skipped. */
  budgetUsd: number;
  /** Postings read at the same time (default 3). */
  concurrency?: number;
  /** Called after each posting is read, failed or skipped. */
  onProgress?: (done: number, total: number, result: CaseResult) => void;
}

export interface CaseResult {
  id: string;
  field: EvaluationCase["field"];
  language: string;
  /** read: scored. failed: the extractor threw (scored as all wrong). skipped: the budget ran out (not scored). */
  status: "read" | "failed" | "skipped";
  costUsd: number;
  error?: string;
  score?: CaseScore;
  /** What the extractor returned, kept so a report can be inspected posting by posting. */
  facts?: PostingFacts;
}

/** A list fact type: how many labelled facts were found, and how many found facts were labelled. */
export interface ListFactScore {
  fact: string;
  type: "list";
  expected: number;
  extracted: number;
  matched: number;
  /** matched / extracted, or null when nothing was extracted. */
  precision: number | null;
  /** matched / expected, or null when nothing was labelled. */
  recall: number | null;
  /** 2·matched / (expected + extracted), or null when there was nothing to find and nothing found. */
  f1: number | null;
  /** Of the matched facts, the share asked the same way (required or preferred); null for location. */
  kindAgreement: number | null;
}

/** A single fact type: right or wrong once per posting. */
export interface SingleFactScore {
  fact: string;
  type: "single";
  correct: number;
  total: number;
  accuracy: number | null;
}

export type FactScore = ListFactScore | SingleFactScore;

export interface EvaluationSummary {
  /** Postings scored (read or failed); skipped ones aren't. */
  postings: number;
  failed: number;
  skipped: number;
  facts: FactScore[];
}

export interface EvaluationReport {
  /** The model that answered (from the first successful read), or null if none did. */
  model: string | null;
  costUsd: number;
  summary: EvaluationSummary;
  /** The same summary per posting language ("en", "bg") and per field ("dev", "security", "design"). */
  slices: Record<string, EvaluationSummary>;
  cases: CaseResult[];
}

/** List fact types in report order, with the CaseScore key each is read from. */
const listFacts: [string, keyof CaseScore][] = [
  ["requirements", "requirements"], ["years", "years"], ["languages", "languages"],
  ["certificates", "certificates"], ["location", "locations"],
];
const singleFacts: [string, keyof CaseScore][] = [
  ["remote", "remote"], ["work authorisation", "workAuthorisation"], ["salary", "salary"], ["posting language", "language"],
];

export async function runEvaluation(options: EvaluationOptions): Promise<EvaluationReport> {
  const { cases, extractor, budgetUsd, onProgress } = options;
  const results: CaseResult[] = new Array(cases.length);
  let committed = 0; // spent plus the estimates of reads in flight
  let spent = 0;
  let model: string | null = null;
  let next = 0, done = 0;

  async function readOne(i: number) {
    const c = cases[i]!;
    const base = { id: c.id, field: c.field, language: c.expected.language };
    const estimate = extractor.estimateCostUsd(c.input);
    if (committed + estimate > budgetUsd) {
      results[i] = { ...base, status: "skipped", costUsd: 0 };
    } else {
      committed += estimate;
      try {
        const out = await extractor.extract(c.input);
        const cost = Number.isFinite(out.costUsd) && out.costUsd >= 0 ? out.costUsd : estimate;
        spent += cost; committed += cost - estimate;
        model ??= out.model;
        results[i] = { ...base, status: "read", costUsd: cost, score: scoreCase(c.expected, out.facts), facts: out.facts };
      } catch (err) {
        const billed = (err as { costUsd?: unknown } | null)?.costUsd;
        const cost = typeof billed === "number" && billed > 0 ? billed : 0;
        spent += cost; committed += cost - estimate;
        results[i] = { ...base, status: "failed", costUsd: cost, error: err instanceof Error ? err.message : String(err) };
      }
    }
    onProgress?.(++done, cases.length, results[i]!);
  }

  const worker = async () => { while (next < cases.length) await readOne(next++); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 3, cases.length)) }, worker));

  const withExpected = results.map((r, i) => ({ r, c: cases[i]! }));
  const sliceKeys = [...new Set(cases.flatMap((c) => [c.expected.language, c.field]))];
  const slices = Object.fromEntries(sliceKeys.map((k) => [k, summarise(withExpected.filter(({ c }) => c.expected.language === k || c.field === k))]));
  return { model, costUsd: spent, summary: summarise(withExpected), slices, cases: results };
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

function summarise(rows: { r: CaseResult; c: EvaluationCase }[]): EvaluationSummary {
  const scored = rows.filter(({ r }) => r.status !== "skipped");
  /** A failed read finds nothing and gets every single fact wrong. */
  const scoreOf = ({ r, c }: { r: CaseResult; c: EvaluationCase }): CaseScore => r.score ?? failedScore(c);
  const facts: FactScore[] = [
    ...listFacts.map(([fact, key]): ListFactScore => {
      const parts = scored.map((row) => scoreOf(row)[key] as ListScore);
      const sum = (f: (s: ListScore) => number) => parts.reduce((n, s) => n + f(s), 0);
      const expected = sum((s) => s.expected), extracted = sum((s) => s.extracted), matched = sum((s) => s.matched);
      const precision = ratio(matched, extracted), recall = ratio(matched, expected);
      // Nothing labelled and nothing found: no score. Otherwise F1, which is 0 when nothing matched.
      const f1 = expected + extracted === 0 ? null : matched === 0 ? 0 : (2 * matched) / (expected + extracted);
      const kindAgreement = key === "locations" ? null : ratio(sum((s) => s.kindAgreed ?? 0), matched);
      return { fact, type: "list", expected, extracted, matched, precision, recall, f1, kindAgreement };
    }),
    ...singleFacts.map(([fact, key]): SingleFactScore => {
      const correct = scored.filter((row) => scoreOf(row)[key] === true).length;
      return { fact, type: "single", correct, total: scored.length, accuracy: ratio(correct, scored.length) };
    }),
  ];
  return {
    postings: scored.length,
    failed: rows.filter(({ r }) => r.status === "failed").length,
    skipped: rows.length - scored.length,
    facts,
  };
}

function failedScore(c: EvaluationCase): CaseScore {
  const e = c.expected;
  const missed = (labels: string[]): ListScore => ({ expected: labels.length, extracted: 0, matched: 0, kindAgreed: 0, missed: labels, extra: [] });
  return {
    requirements: missed(e.requirements.map((r) => r.text)),
    years: missed(e.years.map((y) => `${y.min}+ years`)),
    languages: missed(e.languages.map((l) => l.language)),
    certificates: missed(e.certificates.map((x) => x.name)),
    locations: missed(e.remote.locations),
    remote: false, workAuthorisation: false, salary: false, language: false,
  };
}
