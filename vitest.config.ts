import { defineConfig } from "vitest/config";
import path from "node:path";

// Narrow test scope to tests/**. We don't want vitest discovering Next.js
// route files or the app code itself — that pulls in server-only imports
// and tsx that vitest isn't configured to transform.

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: false,
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
