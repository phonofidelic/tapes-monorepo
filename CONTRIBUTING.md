# Contributing to Tapes

Thanks for contributing! This guide covers the local workflow and the checks CI
runs, so your pull request goes green the first time.

## Prerequisites

- **Node.js 24** (see [`.nvmrc`](./.nvmrc)) — run `corepack enable` so the pinned
  **Yarn 4** is used.
- macOS is assumed for the end-to-end recording flow (see the
  [README](./README.md#prerequisites)).

```sh
corepack enable
yarn            # install dependencies
```

## Development workflow

1. **Branch** off `main`.
2. Make your changes. Run the app with `yarn dev` (or `yarn dev:https` for the LAN
   recording flow).
3. **Match CI locally** before pushing:

   ```sh
   yarn lint
   yarn check-types
   yarn build
   yarn test          # unit tests (core)
   yarn format        # Prettier — keep the tree clean
   ```

   For `web-client` changes, also run the e2e suite:

   ```sh
   yarn workspace web-client e2e
   ```

4. Open a pull request against `main`.

## Adding a changeset

Versioning uses [Changesets](https://github.com/changesets/changesets). If your
change affects a package's published behavior, add a changeset describing it:

```sh
yarn changeset
```

Commit the generated file. On merge to `main`, the Release workflow opens/updates
a "Version Packages" PR that applies pending changesets.

## Code style

- **Prettier** formats all `.ts`, `.tsx`, and `.md` files — run `yarn format`.
- **ESLint** via the shared `@tapes-monorepo/eslint-config` — run `yarn lint`.
- Commit messages follow **semantic commit** conventions (e.g.
  `fix(electron-client): ...`, `docs: ...`), matching the Renovate config and
  existing history.

## What CI checks

Pull requests to `main` run (see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)):

- **Build & Lint** — `yarn lint`, `yarn check-types`, `yarn build`, and the
  `@tapes-monorepo/core` unit tests. (The `apps/api` Jest suite is currently
  excluded due to a pre-existing compile failure.)
- **E2E (web-client)** — Playwright/Chromium with a virtual audio device.
