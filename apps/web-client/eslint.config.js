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
    // dist-host is the same app built as the host serves it, for the
    // streaming e2e project (e2e/hostBundle.ts).
    ignores: [
      "dist/**",
      "dist-host/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
];
