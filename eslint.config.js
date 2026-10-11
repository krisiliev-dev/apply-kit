import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.output/**", "**/.wxt/**", "docs/**", "data/**", ".claude/**", ".interface-design/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ["extension/src/**/*.ts"],
    ignores: ["extension/src/**/*.test.ts"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["app/ui/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
