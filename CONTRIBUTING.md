# Contributing to Tapes

This guide covers the local workflow and the checks CI runs, so your pull request
passes the first time.

## Prerequisites

- Node.js 24, pinned in [`.nvmrc`](./.nvmrc). Run `corepack enable` so the pinned
  Yarn 4 is used.
- macOS for the end-to-end recording flow. See the
  [README](./README.md#prerequisites).

```sh
corepack enable
yarn            # install dependencies
```

## Development workflow

1. Branch off `main`.
2. Make your changes. Run the app with `yarn dev`. Use `yarn dev:https` for the
   LAN recording flow.
3. Run the same checks CI runs before you push:

   ```sh
   yarn lint
   yarn check-types
   yarn build
   yarn test
   yarn format
   ```

   If you changed `web-client`, also run its end-to-end suite:

   ```sh
   yarn workspace web-client e2e
   ```

   If you changed `electron-client`, run its suite too. It is macOS-only and
   takes several minutes:

   ```sh
   yarn workspace electron-client e2e
   ```

4. Open a pull request against `main`.

## Adding a changeset

Versioning uses [Changesets](https://github.com/changesets/changesets). Add a
changeset when your change affects a package's published behavior:

```sh
yarn changeset
```

Commit the generated file. On merge to `main` the Release workflow opens or
updates a "Version Packages" pull request that applies the pending changesets.

## Code style

- Prettier formats every `.ts`, `.tsx` and `.md` file. Run `yarn format`.
- ESLint uses the shared `@tapes-monorepo/eslint-config`. Run `yarn lint`.
- Commit messages follow semantic commit conventions, for example
  `fix(electron-client): ...` or `docs: ...`. This matches the Renovate config
  and the existing history.
- Write pull request descriptions and doc comments in the plain style described
  in [`CLAUDE.md`](./CLAUDE.md#writing-style-pr-descriptions-commit-bodies-doc-comments).

## What CI checks

Pull requests to `main` run two jobs. See
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

- **Build & Lint** runs `yarn lint`, `yarn check-types` and `yarn build`, then the
  unit tests for `core`, `electron-client` and `web-client`. The `apps/api` Jest
  suite is excluded because of a pre-existing compile failure.
- **E2E (web-client)** runs Playwright against Chromium, with a virtual audio
  device.

The electron end-to-end suite is not part of the pull request gate. It runs
nightly on a macOS runner, and you can trigger it by hand. See
[`.github/workflows/e2e-electron.yml`](./.github/workflows/e2e-electron.yml).
