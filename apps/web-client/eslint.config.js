import { config } from "@tapes-monorepo/eslint-config/react-internal";
import globals from "globals";

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    // Playwright config and specs, and the build scripts, run in Node rather
    // than the browser.
    files: ["e2e/**/*.ts", "playwright.config.ts", "scripts/**/*.mjs"],
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
