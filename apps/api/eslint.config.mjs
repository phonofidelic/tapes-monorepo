import { config } from "@tapes-monorepo/eslint-config/base";
import globals from "globals";

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  {
    ignores: ["dist/**", "eslint.config.mjs"],
  },
];
