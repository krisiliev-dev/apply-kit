import type { CVContent } from "@/lib/types";
import type { CvDocument } from "@/lib/doc/types";
import type { ParsedJob } from "@/lib/app/types";
import type {
  AffindaExtracted,
  KeywordScore,
} from "./types";
import { extractPlainText } from "./extractText";

// ————————————————————————————————————————————————
// Layer 2 — Keyword alignment.
//
// Scores the fraction of job keywords that surface in the CV text. Two
// interfaces:
//   • evaluateDraftKeywords — for the /jobs/draft flow, compares a drafted
//     CVContent against the base CVContent (hallucination guard) and scores
//     keyword coverage using the drafted corpus.
//   • scoreCvDocumentKeywords — for the editor eval. Prefers Affinda's
//     extracted text when available; falls back to raw CvDocument text.
//
// Both share the same corpus-normalization + coverage math.
// ————————————————————————————————————————————————

export const DEFAULT_BULLET_CHAR_CAP = 160;

export type DraftWarning = {
  kind:
    | "hallucinated-company"
    | "hallucinated-role"
    | "bullet-over-cap"
    | "missing-keywords"
    | "summary-too-long";
  message: string;
};

export type DraftEvalResult = {
  /** 0..1 composite score. Higher is better. */
  score: number;
  /** Keyword-coverage fraction (0..1). */
  keywordCoverage: number;
  /** Count of bullets that exceed the char cap. */
  overLongBullets: number;
  /** Count of experiences where company or role isn't in the base CV. */
  fabricatedEntries: number;
  warnings: DraftWarning[];
};

type DraftEvalInput = {
  draft: CVContent;
  baseCv: CVContent;
  job: ParsedJob;
  bulletCharCap?: number;
  /** Minimum fraction of job keywords we expect to see somewhere in the draft. */
  keywordCoverageFloor?: number;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectDraftCorpus(draft: CVContent): string {
  const parts: string[] = [];
  if (draft.profile.summary) parts.push(draft.profile.summary);
  if (draft.profile.title) parts.push(draft.profile.title);
  for (const exp of draft.experiences) {
    if (exp.summary) parts.push(exp.summary);
    for (const b of exp.bullets ?? []) parts.push(b);
    for (const t of exp.tags ?? []) parts.push(t);
  }
  for (const g of draft.skills ?? []) {
    parts.push(g.label);
    for (const it of g.items) parts.push(it);
  }
  for (const it of draft.interests ?? []) parts.push(it);
  return norm(parts.join(" \n "));
}

function collectAffindaCorpus(extracted: AffindaExtracted): string {
  const parts: string[] = [];
  if (extracted.summary) parts.push(extracted.summary);
  for (const w of extracted.workExperience) {
    if (w.title) parts.push(w.title);
    if (w.company) parts.push(w.company);
    for (const b of w.bullets ?? []) parts.push(b);
  }
  for (const s of extracted.skills) parts.push(s);
  for (const e of extracted.education) {
    if (e.degree) parts.push(e.degree);
    if (e.school) parts.push(e.school);
  }
  for (const l of extracted.languages ?? []) parts.push(l);
  return norm(parts.join(" \n "));
}

export function evaluateDraftKeywords(input: DraftEvalInput): DraftEvalResult {
  const cap = input.bulletCharCap ?? DEFAULT_BULLET_CHAR_CAP;
  const floor = input.keywordCoverageFloor ?? 0.45;
  const warnings: DraftWarning[] = [];

  const baseCompanies = new Set(
    input.baseCv.experiences.map((e) => norm(e.company)).filter(Boolean),
  );
  const baseRoles = new Set(
    input.baseCv.experiences.map((e) => norm(e.role)).filter(Boolean),
  );

  let fabricatedEntries = 0;
  for (const exp of input.draft.experiences) {
    const company = norm(exp.company);
    const role = norm(exp.role);
    if (company && !baseCompanies.has(company)) {
      fabricatedEntries++;
      warnings.push({
        kind: "hallucinated-company",
        message: `Experience "${exp.company}" isn't in the base CV — drafter may have invented it.`,
      });
    }
    if (role && !baseRoles.has(role)) {
      warnings.push({
        kind: "hallucinated-role",
        message: `Role title "${exp.role}" at ${exp.company} isn't in the base CV verbatim.`,
      });
    }
  }

  let overLongBullets = 0;
  for (const exp of input.draft.experiences) {
    for (const b of exp.bullets ?? []) {
      if (b.length > cap) {
        overLongBullets++;
        warnings.push({
          kind: "bullet-over-cap",
          message: `Bullet at ${exp.company} is ${b.length} chars (cap ${cap}): "${b.slice(0, 80)}…"`,
        });
      }
    }
  }

  const summary = input.draft.profile.summary ?? "";
  if (summary.length > 420) {
    warnings.push({
      kind: "summary-too-long",
      message: `Profile summary is ${summary.length} chars — aim for a tight 2–3 sentences.`,
    });
  }

  const corpus = collectDraftCorpus(input.draft);
  const keywords = input.job.keywords ?? [];
  const matched = keywords.filter((k) => {
    const n = norm(k);
    return n.length > 0 && corpus.includes(n);
  });
  const keywordCoverage = keywords.length > 0 ? matched.length / keywords.length : 1;

  if (keywords.length > 0 && keywordCoverage < floor) {
    const missing = keywords.filter((k) => !corpus.includes(norm(k)));
    warnings.push({
      kind: "missing-keywords",
      message: `Only ${Math.round(keywordCoverage * 100)}% of job keywords surface in the draft. Missing: ${missing
        .slice(0, 6)
        .join(", ")}${missing.length > 6 ? "…" : ""}`,
    });
  }

  const totalBullets = input.draft.experiences.reduce(
    (n, e) => n + (e.bullets?.length ?? 0),
    0,
  );
  const bulletDiscipline =
    totalBullets === 0 ? 1 : 1 - Math.min(overLongBullets / totalBullets, 1);
  const truthfulness =
    input.draft.experiences.length === 0
      ? 1
      : 1 - Math.min(fabricatedEntries / input.draft.experiences.length, 1);

  const score =
    0.6 * keywordCoverage + 0.3 * truthfulness + 0.1 * bulletDiscipline;

  return {
    score: Math.max(0, Math.min(1, score)),
    keywordCoverage,
    overLongBullets,
    fabricatedEntries,
    warnings,
  };
}

// ————————————————————————————————————————————————
// Doc-level keyword scoring (for the editor "Evaluate + improve" flow).
//
// When Affinda extraction is present, we score keywords against what the ATS
// actually extracted — that's the real signal. When it's absent, we fall back
// to raw document text.
// ————————————————————————————————————————————————

type DocKeywordInput = {
  doc: CvDocument;
  job: ParsedJob | null;
  extracted?: AffindaExtracted | null;
  keywordCoverageFloor?: number;
};

export function scoreCvDocumentKeywords(input: DocKeywordInput): KeywordScore {
  const warnings: string[] = [];
  const floor = input.keywordCoverageFloor ?? 0.5;

  const corpus = input.extracted
    ? collectAffindaCorpus(input.extracted)
    : norm(extractPlainText(input.doc));

  const keywords = input.job?.keywords ?? [];

  if (keywords.length === 0) {
    // No job context: coverage is undefined. Give a neutral 70 so the composite
    // still works without inflating above "real" evaluations.
    return {
      score: 70,
      coverage: 1,
      missed: [],
      matched: [],
      warnings: [
        "No parsed job attached — keyword alignment is neutral (70/100).",
      ],
    };
  }

  const matched: string[] = [];
  const missed: string[] = [];
  for (const k of keywords) {
    const n = norm(k);
    if (!n) continue;
    if (corpus.includes(n)) matched.push(k);
    else missed.push(k);
  }

  const denom = matched.length + missed.length;
  const coverage = denom === 0 ? 1 : matched.length / denom;

  if (coverage < floor) {
    warnings.push(
      `Only ${Math.round(coverage * 100)}% of the job's keywords appear in the ${
        input.extracted ? "parsed" : "raw"
      } CV text. Missing: ${missed.slice(0, 8).join(", ")}${
        missed.length > 8 ? "…" : ""
      }`,
    );
  }

  if (!input.extracted) {
    warnings.push(
      "Keyword check ran on raw document text — some words may be visible to a human but lost to a parser.",
    );
  }

  // Cap at 95 — keyword overlap alone shouldn't be a perfect score. The
  // recruiter layer deals with nuance.
  const score = Math.round(Math.min(0.95, coverage) * 100);

  return { score, coverage, matched, missed, warnings };
}

// ————————————————————————————————————————————————
// Per-application eval persistence
// ————————————————————————————————————————————————

const STORAGE_KEY = "cv-maker:draft-evals";

type EvalStore = Record<string, DraftEvalResult>;

function readStore(): EvalStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as EvalStore;
  } catch {
    return {};
  }
}

function writeStore(store: EvalStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore quota
  }
}

export function saveDraftEval(appId: string, result: DraftEvalResult): void {
  const store = readStore();
  store[appId] = result;
  writeStore(store);
}

export function loadDraftEval(appId: string): DraftEvalResult | null {
  const store = readStore();
  return store[appId] ?? null;
}
