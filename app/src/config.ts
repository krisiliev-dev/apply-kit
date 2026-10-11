import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
  };
}
