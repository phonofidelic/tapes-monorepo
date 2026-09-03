import { config } from "@tapes-monorepo/eslint-config/react-internal";
import globals from "globals";

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    // The Playwright config and specs run in Node rather than the browser.
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    ignores: [
      ".vite/**",
      "web-client/**",
      // The packaged app, and what a run of the e2e suite leaves behind.
      "out/**",
      "out-e2e/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
];
