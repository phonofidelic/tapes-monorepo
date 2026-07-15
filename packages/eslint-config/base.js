import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
      // Advisory, not blocking: a backlog of pre-existing violations that each
      // need per-site judgement to type properly. Visible, but not a CI gate.
      // Remove this override once #218 clears them. (react-hooks/exhaustive-deps
      // is likewise advisory, but ships as "warn" upstream and needs no override.)
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Build output and CommonJS config shims (postcss.config.cjs, etc.) are
    // not application source and should not be linted.
    ignores: ["dist/**", "**/*.cjs"],
  },
];
