// Entry point for `pnpm eval:extraction`. Loads settings like the service (.env, OPENROUTER_*,
// AI_MONTHLY_CAP_USD, APPLY_KIT_DB_PATH) and runs the real extractor over eval/extraction/postings.
import { join } from "node:path";
import { createOpenRouterExtractor } from "../extraction/openrouter.ts";
import { loadEnv, readConfig, repoRoot } from "../config.ts";
import { runExtractionEvaluation } from "./cli.ts";
import { openSpendLedger } from "./ledger.ts";

loadEnv();

const code = await runExtractionEvaluation({
  env: process.env,
  casesDir: join(repoRoot, "eval", "extraction", "postings"),
  reportsDir: join(repoRoot, "eval", "extraction", "reports"),
  createExtractor: (options) => createOpenRouterExtractor(options),
  openLedger: () => openSpendLedger(readConfig().dbPath),
  now: () => new Date(),
  log: (line) => console.log(line),
}).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  return 1;
});
process.exitCode = code;
