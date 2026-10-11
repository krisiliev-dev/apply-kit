// `pnpm eval:extraction`: runs the real extractor over the hand-labelled evaluation set and reports
// accuracy per fact type. On demand only (it costs money); never part of `pnpm test`.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluationCaseSchema, runEvaluation, type EvaluationCase, type EvaluationSummary, type Extractor, type FactScore } from "@apply-kit/core";
import { formatSlices, formatSummary } from "./format.ts";
import { parseCap } from "../config.ts";

/** The month's AI spending ledger the monthly cap is checked against (the service's own, when it exists). */
export interface SpendLedger {
  spentThisMonthUsd(): number;
  record(costUsd: number): void;
  close(): void;
}

export interface EvaluationCliDeps {
  env: Record<string, string | undefined>;
  /** Folder of labelled postings (eval/extraction/postings). */
  casesDir: string;
  /** Where reports are saved (eval/extraction/reports, gitignored). */
  reportsDir: string;
  createExtractor(options: { apiKey: string; model?: string; providers: string[] }): Extractor;
  openLedger(): SpendLedger;
  now(): Date;
  log(line: string): void;
}

/** Returns the process exit code. */
export async function runExtractionEvaluation(deps: EvaluationCliDeps): Promise<number> {
  const { env, log } = deps;
  if (!env.OPENROUTER_API_KEY) {
    log("OPENROUTER_API_KEY isn't set: add it to .env (the same key the service uses) and run again.");
    log("The evaluation calls the real extractor, so it never runs without the key.");
    return 1;
  }
  const cap = parseCap(env.AI_MONTHLY_CAP_USD);
  if (cap === undefined) {
    log("AI_MONTHLY_CAP_USD isn't set: add a monthly cap in USD to .env (e.g. AI_MONTHLY_CAP_USD=10) and run again.");
    log("Like the service, the evaluation spends nothing on AI without a cap.");
    return 1;
  }

  const cases = loadCases(deps.casesDir);
  const extractor = deps.createExtractor({
    apiKey: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_MODEL || undefined,
    providers: (env.OPENROUTER_PROVIDERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  });
  const estimateUsd = cases.reduce((sum, c) => sum + extractor.estimateCostUsd(c.input), 0);

  const ledger = deps.openLedger();
  try {
    const leftUsd = Math.max(0, cap - ledger.spentThisMonthUsd());
    if (estimateUsd > leftUsd) {
      log(`This run of ${cases.length} postings is estimated at up to ${usd(estimateUsd)}, but only ${usd(leftUsd)} of this month's AI budget is left (AI_MONTHLY_CAP_USD=${cap}).`);
      log("Raise the cap or wait for next month; nothing was read.");
      return 1;
    }

    const startedAt = deps.now();
    log(`Reading ${cases.length} labelled postings with the real extractor (estimated up to ${usd(estimateUsd)}; ${usd(leftUsd)} of this month's budget left).`);
    const report = await runEvaluation({
      cases, extractor, budgetUsd: leftUsd,
      onProgress: (done, total, r) => {
        if (r.costUsd > 0) ledger.record(r.costUsd);
        const what = r.status === "read" ? usd(r.costUsd) : r.status === "failed" ? `failed: ${r.error}` : "skipped: budget";
        log(`  [${done}/${total}] ${r.id} · ${what}`);
      },
    });

    const previous = latestReport(deps.reportsDir);
    log("");
    log(`Extraction accuracy · ${report.model ?? "no model answered"} · ${report.summary.postings} postings (${report.summary.failed} failed, ${report.summary.skipped} skipped)`);
    if (previous) log(`Change is against ${previous.file}${previous.model && previous.model !== report.model ? ` (model ${previous.model})` : ""}.`);
    log("");
    for (const line of formatSummary(report.summary, previous?.summary)) log(line);
    log("");
    log("By slice (F1 for lists, accuracy for single facts):");
    for (const line of formatSlices(report.summary, report.slices)) log(line);
    log("");
    log(`Cost: ${usd(report.costUsd)} (estimated up to ${usd(estimateUsd)})`);

    mkdirSync(deps.reportsDir, { recursive: true });
    const file = join(deps.reportsDir, `extraction-${startedAt.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-")}.json`);
    const saved = {
      startedAt: startedAt.toISOString(),
      finishedAt: deps.now().toISOString(),
      model: report.model,
      postings: cases.length,
      costUsd: report.costUsd,
      estimatedUsd: estimateUsd,
      summary: report.summary,
      slices: report.slices,
      cases: report.cases,
    };
    writeFileSync(file, JSON.stringify(saved, null, 2) + "\n");
    log(`Report: ${file}`);
    return 0;
  } finally {
    ledger.close();
  }
}

/** The newest saved report, to compare against. Reports are named by their start time, so names sort by time. */
function latestReport(dir: string): { file: string; model: string | null; summary: EvaluationSummary } | null {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).filter((f) => /^extraction-.*\.json$/.test(f)).sort().at(-1);
  if (!file) return null;
  try {
    const r = JSON.parse(readFileSync(join(dir, file), "utf8")) as { model?: string | null; summary?: { facts?: FactScore[] } };
    return r.summary?.facts ? { file, model: r.model ?? null, summary: r.summary as EvaluationSummary } : null;
  } catch {
    return null;
  }
}

/** Every labelled posting in the folder, validated; a broken file stops the run with its name. */
export function loadCases(dir: string): EvaluationCase[] {
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const parsed = evaluationCaseSchema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
    if (!parsed.success) throw new Error(`${f} isn't a valid labelled posting: ${parsed.error.message}`);
    return parsed.data;
  });
}

/** "$0.0042", "$1.25": four decimals at most, trailing zeros dropped. */
export const usd = (n: number) => `$${Math.round(n * 10_000) / 10_000}`;
