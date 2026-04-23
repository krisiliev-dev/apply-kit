import type { CVContent } from "@/lib/types";
import type { ParsedJob } from "@/lib/app/types";

// Lightweight heuristic scoring for a tailored CV draft.
//
// This does NOT try to be an LLM judge. It's a cheap static check that flags
// the two failure modes the prompt is meant to prevent:
//   1. Hallucinated companies / roles / titles not present in the base CV.
//   2. Bullets that drift past the configured character cap.
// Plus one positive signal — keyword coverage from the parsed job.
//
// Output is a `{ score, warnings }` pair that the /jobs/[appId] UI surfaces so
// the user can eyeball whether the draft is worth using as-is.

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

type EvalInput = {
  draft: CVContent;
  baseCv: CVContent;
  job: ParsedJob;
  bulletCharCap?: number;
  /** Minimum fraction of job keywords we expect to see somewhere in the draft. */
  keywordCoverageFloor?: number;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#./\s-]/g, " ").replace(/\s+/g, " ").trim();
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

export function evaluateDraft(input: EvalInput): DraftEvalResult {
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
      // Role changes are softer than company changes (titles get rewritten),
      // but still worth flagging if the user wants strict truthfulness.
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

  // Composite: 0.6 weight on keyword coverage, 0.3 on no-fabrication, 0.1 on
  // bullet discipline. We don't want one big bullet to tank the whole score.
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
// Per-application eval persistence
//
// Stored in localStorage so /jobs/[appId] can surface warnings without
// extending the shared Application type (off-limits for this iteration).
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
