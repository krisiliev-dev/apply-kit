// Entry point for `pnpm eval:tailoring` (and `pnpm eval:tailoring:verdicts` with "verdicts"). Loads
// settings like the service (.env, OPENROUTER_*, AI_MONTHLY_CAP_USD, APPLY_KIT_DB_PATH) plus the
// evaluation's own (EVAL_STRONGER_MODEL, EVAL_STRONGER_PROVIDERS, EVAL_STRONGER_MAX_PRICE,
// APPLY_KIT_TAILORING_SET), and writes packages with the real writer and headless Chromium.
import { randomInt } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { createOpenRouterWriter } from "../writing/openrouter.ts";
import { chromiumInstalled, createChromiumRenderer } from "../documents/chromium.ts";
import { createPdfJsReader } from "../documents/pdf-text.ts";
import { loadEnv, readConfig, repoRoot } from "../config.ts";
import { recordTailoringVerdicts, runTailoringEvaluationCli } from "./tailoring-cli.ts";
import { evaluationEngine } from "./tailoring-engine.ts";
import { openSpendLedger } from "./ledger.ts";

loadEnv();

const setDir = resolve(process.env.APPLY_KIT_TAILORING_SET || join(repoRoot, "eval", "tailoring"));
const insideRepo = !relative(repoRoot, setDir).startsWith("..");
// Runs over the repository's fictional set stay in its gitignored reports folder; a set kept
// elsewhere (real samples in the data folder) keeps its reports beside it.
const reportsDir = join(setDir, "reports");

async function run(): Promise<number> {
  if (process.argv[2] === "verdicts") {
    return recordTailoringVerdicts({ reportsDir, run: process.argv[3], log: (line) => console.log(line) });
  }
  if (!chromiumInstalled()) {
    console.log("Page fit needs Playwright's Chromium: run `pnpm --filter @apply-kit/app exec playwright install chromium-headless-shell`, then try again.");
    return 1;
  }
  const renderer = createChromiumRenderer();
  try {
    return await runTailoringEvaluationCli({
      env: process.env,
      setDir,
      postingsDir: join(repoRoot, "eval", "extraction", "postings"),
      reportsDir,
      insideRepo,
      createWriter: (options) => createOpenRouterWriter(options),
      engine: (pdfDir) => evaluationEngine({ renderer, pdfReader: createPdfJsReader(), pdfDir }),
      openLedger: () => openSpendLedger(readConfig().dbPath),
      now: () => new Date(),
      random: () => randomInt(1_000_000) / 1_000_000,
      log: (line) => console.log(line),
    });
  } finally {
    await renderer.close();
  }
}

process.exitCode = await run().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  return 1;
});
