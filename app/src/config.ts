import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchedule } from "@apply-kit/core";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Loads the repo's gitignored .env into process.env if it exists (values are never logged). */
export function loadEnv(): void {
  const envFile = join(repoRoot, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

/** ADR 0001: one SQLite file in Application Support; the repo's `data` symlink points at this folder. */
export const dataDir = join(homedir(), "Library", "Application Support", "apply-kit");

export function readConfig() {
  return {
    port: Number(process.env.PORT ?? 4310),
    dbPath: process.env.APPLY_KIT_DB_PATH || join(dataDir, "apply-kit.db"),
    uiDir: fileURLToPath(new URL("../ui/dist/", import.meta.url)),
    sources: parseSources(process.env.APPLY_KIT_SOURCES ?? ""),
    ai: {
      /** OPENROUTER_API_KEY. Without it postings can't be read (each shows why). */
      openRouterApiKey: process.env.OPENROUTER_API_KEY || null,
      /** OPENROUTER_MODEL, default deepseek/deepseek-v4.1-flash. */
      model: process.env.OPENROUTER_MODEL || undefined,
      /** OPENROUTER_PROVIDERS: optional comma-separated allow-list of provider slugs (China-hosted ones are dropped). */
      providers: (process.env.OPENROUTER_PROVIDERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      /** AI_MONTHLY_CAP_USD: hard monthly cap. Unset means no AI spending at all. */
      monthlyCapUsd: parseCap(process.env.AI_MONTHLY_CAP_USD),
    },
    /**
     * MY_EMAIL_ADDRESSES: the addresses you send mail from (comma-separated). A copy you BCC to the
     * job mailbox from one of them marks the follow-up it answers as sent.
     */
    myAddresses: (process.env.MY_EMAIL_ADDRESSES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@")),
    // Defaults: every 30 minutes, 07:00-23:00 local time.
    schedule: parseSchedule({
      every: process.env.APPLY_KIT_CHECK_EVERY_MINUTES,
      window: process.env.APPLY_KIT_CHECK_WINDOW,
    }),
  };
}

export function parseCap(text: string | undefined): number | undefined {
  if (text == null || text.trim() === "") return undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) throw new Error(`AI_MONTHLY_CAP_USD: expected an amount in USD like 10, got "${text}"`);
  return n;
}

/**
 * Config-level Sources until the Sources screen exists: comma-separated `kind:shorthand` pairs,
 * e.g. `greenhouse:payhawkio,greenhouse:another`. The engine validates each shorthand.
 */
export function parseSources(text: string): { kind: string; config: string }[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      if (i < 1) throw new Error(`APPLY_KIT_SOURCES: expected kind:value, got "${s}"`);
      return { kind: s.slice(0, i).trim(), config: s.slice(i + 1).trim() };
    });
}
