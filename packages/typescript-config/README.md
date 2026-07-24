# @tapes-monorepo/typescript-config

Shared `tsconfig.json` base configurations used across the
[Tapes](../../README.md) monorepo. Extend the relevant base from a package's own
`tsconfig.json`:

```jsonc
{
  "extends": "@tapes-monorepo/typescript-config/base.json",
}
```
