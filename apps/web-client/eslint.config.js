import { config } from "@tapes-monorepo/eslint-config/react-internal";
import globals from "globals";

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    // Playwright config and specs run in Node, not the browser.
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    ignores: ["dist/**", "playwright-report/**", "test-results/**"],
  },
];
