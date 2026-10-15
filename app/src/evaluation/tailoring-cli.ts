// `pnpm eval:tailoring` (#69): runs the real writer over the tailoring evaluation set (fictional
// profiles and real postings, English and Bulgarian) through the preparation engine, and reports
// what the honesty validator refused and flagged, stock phrases, length, page fit and cost. With a
// stronger model to compare against (EVAL_STRONGER_MODEL), it writes a blind comparison sheet
// instead, and `pnpm eval:tailoring:verdicts` records Kris's verdicts and only then writes the
// report naming the models. On demand only (it costs money); never part of `pnpm test`.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  blindSheet, estimatePackageUsd, evaluationCaseSchema, formatTailoringReport, readVerdicts, runTailoringEvaluation, tailoringProfileSchema, tailoringSetSchema,
  type BlindKey, type TailoringCase, type TailoringEngine, type TailoringModel, type TailoringReport, type Writer,
} from "@apply-kit/core";
import { DEFAULT_MODEL, type Price } from "../openrouter.ts";
import { parseCap } from "../config.ts";
import { usd, type SpendLedger } from "./cli.ts";

export interface TailoringCliDeps {
  env: Record<string, string | undefined>;
  /** The set: cases.json and profiles/ (eval/tailoring, or APPLY_KIT_TAILORING_SET for real samples kept in the data folder). */
  setDir: string;
  /** The postings the cases name (eval/extraction/postings); a set's own postings/ folder is read first. */
  postingsDir: string;
  /** Where runs are saved (eval/tailoring/reports, gitignored; beside the set when it's outside the repo). */
  reportsDir: string;
  /** Whether the set is inside the repository: then every profile must be fictional. */
  insideRepo: boolean;
  createWriter(options: { apiKey: string; model?: string; providers: string[]; maxPrice?: Price }): Writer;
  /** The engine factory for one run, printing its PDFs into this folder. */
  engine(pdfDir: string): (writer: Writer, budgetUsd: number) => TailoringEngine;
  openLedger(): SpendLedger;
  now(): Date;
  /** Decides which model is Version A per case. */
  random(): number;
  log(line: string): void;
}

/** What the run keeps while the sheet is blind: the report and the key, encoded so a glance doesn't give the models away. */
interface Sealed {
  startedAt: string;
  report: TailoringReport;
  key: BlindKey;
}
const SEALED = ".sealed";
const seal = (s: Sealed) => Buffer.from(JSON.stringify(s), "utf8").toString("base64");
const unseal = (text: string) => JSON.parse(Buffer.from(text, "base64").toString("utf8")) as Sealed;

const list = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

/** "3,15": USD per million prompt and completion tokens. */
function parsePrice(text: string | undefined): Price {
  if (!text?.trim()) return { prompt: 3, completion: 15 };
  const [prompt, completion] = text.split(",").map((s) => Number(s.trim()));
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt! <= 0 || completion! <= 0) {
    throw new Error(`EVAL_STRONGER_MAX_PRICE: expected USD per million prompt and completion tokens like 3,15, got "${text}"`);
  }
  return { prompt: prompt!, completion: completion! };
}

/** The set's cases with their profiles and postings; a broken file stops the run with its name. */
export function loadTailoringSet(setDir: string, postingsDir: string): TailoringCase[] {
  const parse = <T>(file: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { message: string } } }): T => {
    const r = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!r.success) throw new Error(`${file} isn't valid: ${r.error.message}`);
    return r.data;
  };
  const set = parse(join(setDir, "cases.json"), tailoringSetSchema);
  const profileDir = join(setDir, "profiles");
  const profiles = new Map(readdirSync(profileDir).filter((f) => f.endsWith(".json")).map((f) => {
    const p = parse(join(profileDir, f), tailoringProfileSchema);
    return [p.id, p];
  }));
  return set.cases.map((c) => {
    const profile = profiles.get(c.profile);
    if (!profile) throw new Error(`Case ${c.id}: there's no profile ${c.profile} in ${profileDir}`);
    const own = join(setDir, "postings", `${c.posting}.json`);
    const file = existsSync(own) ? own : join(postingsDir, `${c.posting}.json`);
    if (!existsSync(file)) throw new Error(`Case ${c.id}: there's no posting ${c.posting}`);
    const posting = parse(file, evaluationCaseSchema);
    return { id: c.id, profile, posting, questions: c.questions ?? set.questions[posting.expected.language === "bg" ? "bg" : "en"] };
  });
}

/** Returns the process exit code. */
export async function runTailoringEvaluationCli(deps: TailoringCliDeps): Promise<number> {
  const { env, log } = deps;
  if (!env.OPENROUTER_API_KEY) {
    log("OPENROUTER_API_KEY isn't set: add it to .env (the same key the service uses) and run again.");
    log("The evaluation calls the real writer, so it never runs without the key.");
    return 1;
  }
  const cap = parseCap(env.AI_MONTHLY_CAP_USD);
  if (cap === undefined) {
    log("AI_MONTHLY_CAP_USD isn't set: add a monthly cap in USD to .env (e.g. AI_MONTHLY_CAP_USD=10) and run again.");
    log("Like the service, the evaluation spends nothing on AI without a cap.");
    return 1;
  }

  const cases = loadTailoringSet(deps.setDir, deps.postingsDir);
  if (deps.insideRepo) {
    const real = [...new Set(cases.filter((c) => !c.profile.fictional).map((c) => c.profile.id))];
    if (real.length) {
      log(`${real.join(", ")} ${real.length === 1 ? "isn't" : "aren't"} marked fictional. Only made-up people belong in the repository's set:`);
      log("keep real samples in a set inside the data folder and point APPLY_KIT_TAILORING_SET at it. Nothing was run.");
      return 1;
    }
  }

  const providers = list(env.OPENROUTER_PROVIDERS);
  const models: TailoringModel[] = [];
  const main = deps.createWriter({ apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL || undefined, providers });
  models.push({ model: env.OPENROUTER_MODEL || DEFAULT_MODEL, writer: main });
  const stronger = env.EVAL_STRONGER_MODEL?.trim();
  if (stronger) {
    const maxPrice = parsePrice(env.EVAL_STRONGER_MAX_PRICE);
    const strongProviders = list(env.EVAL_STRONGER_PROVIDERS);
    models.push({ model: stronger, writer: deps.createWriter({ apiKey: env.OPENROUTER_API_KEY, model: stronger, providers: strongProviders.length ? strongProviders : providers, maxPrice }) });
  }
  const estimateUsd = cases.reduce((sum, c) => sum + models.reduce((n, m) => n + estimatePackageUsd(c, m.writer), 0), 0);

  const ledger = deps.openLedger();
  try {
    const left = () => Math.max(0, cap - ledger.spentThisMonthUsd());
    if (estimateUsd > left()) {
      log(`This run of ${cases.length * models.length} packages is estimated at up to ${usd(estimateUsd)}, but only ${usd(left())} of this month's AI budget is left (AI_MONTHLY_CAP_USD=${cap}).`);
      log("Raise the cap, wait for next month, or leave EVAL_STRONGER_MODEL unset to run one model; nothing was written.");
      return 1;
    }

    const startedAt = deps.now();
    const dir = join(deps.reportsDir, `tailoring-${startedAt.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-")}`);
    mkdirSync(dir, { recursive: true });
    log(`Writing ${cases.length} packages${models.length > 1 ? " with each of two models" : ""} with the real writer (estimated up to ${usd(estimateUsd)}; ${usd(left())} of this month's budget left).`);
    const report = await runTailoringEvaluation({
      cases, models,
      engine: deps.engine(join(dir, "pdfs")),
      leftUsd: left,
      onProgress: (done, total, p) => {
        if (p.costUsd > 0) ledger.record(p.costUsd);
        // While the sheet is blind, progress says nothing about which model wrote which package.
        if (models.length > 1) { log(`  [${done}/${total}] ${p.caseId} · ${p.status}`); return; }
        const how = p.status === "failed" ? `failed: ${p.error}` : `${p.rejected.length} refused, ${p.flags.length} flagged${p.missing.length ? `, ${p.missing.length} not written` : ""}`;
        log(`  [${done}/${total}] ${p.caseId} · ${p.model} · ${usd(p.costUsd)} · ${how}`);
      },
    });
    log("");
    log(`Cost: ${usd(report.costUsd)} (estimated up to ${usd(estimateUsd)}). PDFs: ${join(dir, "pdfs")}`);

    if (models.length === 1) {
      writeReport(dir, { startedAt: startedAt.toISOString(), report });
      log(`Report: ${join(dir, "report.md")}`);
      log("To compare voice and quality against a stronger model in a blind sheet, set EVAL_STRONGER_MODEL (an OpenRouter model id) and run again.");
      return 0;
    }
    const { sheet, key } = blindSheet(report, deps.random);
    writeFileSync(join(dir, "blind-sheet.md"), sheet + "\n");
    writeFileSync(join(dir, SEALED), seal({ startedAt: startedAt.toISOString(), report, key }));
    log(`Blind sheet: ${join(dir, "blind-sheet.md")}`);
    log("Fill in a verdict for every case (A, B or same), then run `pnpm eval:tailoring:verdicts`.");
    log("The report, which names the models, is written once the verdicts are recorded.");
    return 0;
  } finally {
    ledger.close();
  }
}

function writeReport(dir: string, s: { startedAt: string; report: TailoringReport }, verdicts?: Extract<ReturnType<typeof readVerdicts>, { complete: true }>) {
  writeFileSync(join(dir, "report.md"), formatTailoringReport(s.report, { startedAt: s.startedAt, verdicts }) + "\n");
  writeFileSync(join(dir, "report.json"), JSON.stringify({ startedAt: s.startedAt, ...s.report, verdicts: verdicts ?? null }, null, 2) + "\n");
}

/** `pnpm eval:tailoring:verdicts`: records the verdicts of the latest blind sheet (or the named run), then reveals. */
export async function recordTailoringVerdicts(deps: { reportsDir: string; run?: string; log(line: string): void }): Promise<number> {
  const { log } = deps;
  const runs = existsSync(deps.reportsDir)
    ? readdirSync(deps.reportsDir).filter((d) => d.startsWith("tailoring-") && existsSync(join(deps.reportsDir, d, SEALED))).sort()
    : [];
  const run = deps.run ?? runs.at(-1);
  if (!run || !runs.includes(run)) {
    log(deps.run ? `There's no blind sheet in ${join(deps.reportsDir, deps.run)}.` : `There's no blind sheet in ${deps.reportsDir} yet: run pnpm eval:tailoring with EVAL_STRONGER_MODEL set.`);
    return 1;
  }
  const dir = join(deps.reportsDir, run);
  const sealed = unseal(readFileSync(join(dir, SEALED), "utf8"));
  const reading = readVerdicts(readFileSync(join(dir, "blind-sheet.md"), "utf8"), sealed.key);
  if (!reading.complete) {
    if (reading.missing.length) log(`${reading.missing.length === 1 ? "1 case has" : `${reading.missing.length} cases have`} no verdict yet: ${reading.missing.join(", ")}.`);
    if (reading.unreadable.length) log(`Verdicts must be A, B or same: ${reading.unreadable.join(", ")}.`);
    log(`Fill them in in ${join(dir, "blind-sheet.md")} and run this again. Nothing was revealed.`);
    return 1;
  }
  writeReport(dir, sealed, reading);
  writeFileSync(join(dir, "verdicts.json"), JSON.stringify({ verdicts: reading.verdicts, tally: reading.tally }, null, 2) + "\n");
  const t = reading.tally;
  const models = Object.keys(t).filter((k) => k !== "same").sort((a, b) => t[b]! - t[a]! || a.localeCompare(b));
  log(`Verdicts recorded: ${[...models.map((m) => `${m} preferred ${t[m]}`), `the same ${t.same ?? 0}`].join(" · ")}.`);
  log(`Report: ${join(dir, "report.md")}`);
  return 0;
}
