import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Minimal vitest config — resolves the `@/*` alias the app uses and mounts
// the provider tests under tests/provider/**. No jsdom environment; the
// provider + ledger + pricing tests run fine in the default node env.

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
