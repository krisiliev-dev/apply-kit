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
    // Defaults: every 30 minutes, 07:00-23:00 local time.
    schedule: parseSchedule({
      every: process.env.APPLY_KIT_CHECK_EVERY_MINUTES,
      window: process.env.APPLY_KIT_CHECK_WINDOW,
    }),
  };
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
