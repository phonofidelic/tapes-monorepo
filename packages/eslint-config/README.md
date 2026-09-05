# @tapes-monorepo/eslint-config

Shared ESLint configurations for the [Tapes](../../README.md) monorepo. Every
workspace extends one of them from its own flat ESLint config.

Three entry points are exposed through the package exports:

- `@tapes-monorepo/eslint-config/base` is the base config for any package.
- `@tapes-monorepo/eslint-config/next-js` is for the Next.js apps, web and docs.
- `@tapes-monorepo/eslint-config/react-internal` is for internal React libraries.

Import the relevant config from a package's flat ESLint config:

```js
import { config } from '@tapes-monorepo/eslint-config/base'

export default config
```
