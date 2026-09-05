# @tapes-monorepo/typescript-config

Shared `tsconfig.json` bases for the [Tapes](../../README.md) monorepo. Every
workspace extends one of them from its own tsconfig.

Three bases are provided:

- `base.json` for the two shells, web-client and electron-client.
- `nextjs.json` for the Next.js apps, web and docs.
- `react-library.json` for the React libraries, core and ui.

Extend the relevant base from a package's own `tsconfig.json`:

```jsonc
{
  "extends": "@tapes-monorepo/typescript-config/base.json",
}
```
