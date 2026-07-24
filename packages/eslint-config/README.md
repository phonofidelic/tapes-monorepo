# @tapes-monorepo/eslint-config

Shared ESLint configurations for the [Tapes](../../README.md) monorepo. Exposed
as three entry points via the package exports:

- `@tapes-monorepo/eslint-config/base` — base config for any package.
- `@tapes-monorepo/eslint-config/next-js` — for Next.js apps (`web`, `docs`).
- `@tapes-monorepo/eslint-config/react-internal` — for internal React libraries.

Import the relevant config from a package's flat ESLint config:

```js
import { config } from '@tapes-monorepo/eslint-config/base'

export default config
```
