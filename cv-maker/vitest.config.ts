import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Vitest config shared by:
//   tests/settings/** — durability suite (uses localStorage + fake-indexeddb,
//                       needs jsdom)
//   tests/provider/** — AI provider + pricing + ledger suite (node would
//                       suffice, but jsdom is a no-op overhead here)

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: false,
    setupFiles: ["tests/setup.ts"],
  },
});
