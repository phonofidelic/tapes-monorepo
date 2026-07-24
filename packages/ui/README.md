# @tapes-monorepo/ui

Shared, presentational React component library for [Tapes](../../README.md),
styled with Tailwind. Consumed by `@tapes-monorepo/core`.

Built as a library with [`vite-plus`](https://www.npmjs.com/package/vite-plus);
components are exposed via the package exports (`.` and `./style.css`).

## Scripts

```sh
yarn workspace @tapes-monorepo/ui build              # vp build
yarn workspace @tapes-monorepo/ui dev                # vp build --watch
yarn workspace @tapes-monorepo/ui generate:component # scaffold a new component
```
