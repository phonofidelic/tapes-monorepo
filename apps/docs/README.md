# docs

The [Tapes](../../README.md) documentation site, built with
[Next.js](https://nextjs.org). It is not part of the recording app.

The site is still a starter scaffold. Project documentation lives in the root
README and the per-workspace READMEs for now. Building this into a full
documentation site is a planned follow-up.

## Develop

```sh
yarn workspace docs dev   # http://localhost:3001
```

## Build

```sh
yarn workspace docs build
yarn workspace docs start   # serve the production build
```

No app-specific environment variables are required.
