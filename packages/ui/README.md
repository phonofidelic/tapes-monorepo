# @tapes-monorepo/ui

Shared presentational React components for [Tapes](../../README.md), styled with
Tailwind. Consumed by core and by the two Next.js sites, web and docs.

It is built as a library with
[`vite-plus`](https://www.npmjs.com/package/vite-plus). Consumers import it
through the package exports, `.` for the components and `./style.css` for the
styles.

## Scripts

```sh
yarn workspace @tapes-monorepo/ui build              # vp build
yarn workspace @tapes-monorepo/ui dev                # vp build --watch
yarn workspace @tapes-monorepo/ui generate:component # scaffold a new component
```
