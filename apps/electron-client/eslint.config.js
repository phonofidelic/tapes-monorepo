import { config } from "@tapes-monorepo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    ignores: [".vite/**", "downloadExecutables.js"],
  },
];
