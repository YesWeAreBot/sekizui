import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: [".agents/**", ".claude/**", ".codex/**", ".cursor/**", ".gemini/**", ".omp/**", ".opencode/**", ".pi/**"],
  plugins: ["eslint", "import", "node", "oxc", "promise", "typescript", "unicorn", "vitest"],
  rules: {
    "constructor-super": "error",
    "default-case": "error",
    "no-inner-declarations": "error",
    "typescript/array-type": ["error", { default: "array-simple" }],
    "unicorn/catch-error-name": "error",
    "unicorn/consistent-function-scoping": "error",
    "unicorn/import-style": "error",
    "unicorn/new-for-builtins": "error",
    "unicorn/prefer-export-from": "error",
  },
});
