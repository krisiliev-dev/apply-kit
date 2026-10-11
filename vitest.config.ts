import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "app/src/**/*.test.ts", "extension/src/**/*.test.ts"],
  },
});
