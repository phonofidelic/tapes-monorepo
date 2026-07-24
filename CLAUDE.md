# CLAUDE.md

Orientation for AI agents working in this repo. For full detail, follow the links
to the READMEs rather than duplicating them here.

## What this is

**Tapes** — a local-first audio recording app. Audio is recorded in the browser
and synced peer-to-peer across LAN devices with **Automerge** CRDTs (no central
DB). The desktop app is the sync **host**; other devices join as **guests** over
the LAN. See [`README.md`](./README.md) for architecture.

## Layout

- `packages/core` (`@tapes-monorepo/core`) — the actual Tapes app (`app/`) + sync
  - QR pairing. Consumed by `web-client` and the electron renderer.
- `packages/ui` — shared React components. `packages/{eslint,tailwind,typescript}-config` — shared config.
- `apps/web-client` — browser shell; owns mic capture; has the Playwright e2e suite (port `3000`).
- `apps/electron-client` — desktop host; embedded sync server on port `9001`; native audio (SoX, `switchaudio-osx`).
- `apps/api` — standalone NestJS Automerge sync server (port `3031`); auth module currently disabled.
- `apps/web` (port `3002`), `apps/docs` (port `3001`) — Next.js sites.

## Key commands

- Setup: `corepack enable` then `yarn`. Node 24 (`.nvmrc`), Yarn 4, Turborepo.
- `yarn dev` / `yarn dev:https` — run apps (use `:https` for the LAN mic flow).
- Before pushing: `yarn lint`, `yarn check-types`, `yarn build`, `yarn test`, `yarn format`.
- `yarn changeset` — add a changeset when a package's published behavior changes.

## Gotchas

- **macOS is assumed** for the recording flow: `ipconfig getifaddr en0`, SoX,
  `switchaudio-osx`.
- **Local HTTPS** is required for mic capture on LAN guests (`yarn dev:https`).
- `apps/api` dev HTTPS reads `localhost.pem`, but the `cert` script writes
  `localhost-cert.pem` — rename it or the API won't boot.
- Env files are git-ignored and pulled from Vercel (`yarn ... pull`); committed
  `.env.example` files document the vars.
- CI runs unit tests only for `@tapes-monorepo/core`; the `apps/api` Jest suite is
  excluded (pre-existing compile failure). Don't treat that as a gap to "fix"
  without checking.
