# TAP-63 — Add documentation

> Refinement + implementation plan for [TAP-63](https://linear.app/tapes/issue/TAP-63/add-documentation).
> Project: Platform & Maintenance · Team: Tapes

## Context

Every README in the monorepo is still framework boilerplate that describes the
_starter template_, not the Tapes product:

| File                                                                    | Current state                                                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `README.md` (root)                                                      | Stock `create-turbo` starter ("Turborepo starter", mentions pnpm/`@repo/ui` — neither is true) |
| `apps/api/README.md`                                                    | Stock NestJS starter                                                                           |
| `apps/web/README.md`, `apps/docs/README.md`                             | Stock `create-next-app`                                                                        |
| `apps/web-client/README.md`                                             | `# web-client` (one line)                                                                      |
| `packages/core/README.md`                                               | `# core` (one line)                                                                            |
| `apps/electron-client`                                                  | No README at all                                                                               |
| `packages/ui`, `packages/tailwind-config`, `packages/typescript-config` | No README                                                                                      |

There is also **no `CONTRIBUTING.md`, no `LICENSE`, no `CLAUDE.md`, and no
`.env.example`** anywhere. A new contributor (or an AI agent) has no accurate
description of what Tapes is, how the apps relate, or how to run the project —
and the one document that exists (root README) is actively misleading.

The non-obvious parts of the system that are easy to get wrong and most need
documenting:

- The dev flow assumes **macOS** (`ipconfig getifaddr en0`, SoX, `switchaudio-osx`).
- **Local HTTPS** is required for mic capture on LAN guests, and the setup differs
  per surface (api uses hand-generated `localhost*.pem`; electron uses the
  `selfsigned` package; web-client uses `@vitejs/plugin-basic-ssl`).
- The `api` dev-HTTPS certs (`localhost-key.pem` + `localhost-cert.pem`) are
  hand-generated with `yarn workspace api cert`. (A prior `main.ts` vs. `cert`
  filename mismatch was fixed in #260.)
- Env files are git-ignored and pulled from Vercel (`vercel env pull`); there is
  no committed example.

## What Tapes is (for the docs to describe accurately)

Tapes is a **local-first audio recording app**. You record audio in the browser;
recordings and their metadata are stored locally and synced peer-to-peer across
devices on your LAN using **Automerge CRDTs** — no central database. The desktop
app acts as the sync **host**; other devices join as **guests** over the local
network (paired via a QR code).

**Architecture / responsibilities:**

- **`packages/core`** (`@tapes-monorepo/core`) — the actual Tapes application:
  the `App` component, views, components, and context in `packages/core/app/`.
  Owns sync (Automerge repo: IndexedDB storage in the browser, WebSocket +
  BroadcastChannel networking, `@automerge/automerge-repo-react-hooks`) and LAN
  pairing (`qrcode.react`). Consumed by both `web-client` and the electron renderer.
- **`packages/ui`** (`@tapes-monorepo/ui`) — shared presentational React component
  library (Tailwind 4).
- **`apps/web-client`** — thin Vite + React 19 shell that mounts core's `App`,
  runs an Automerge worker (`src/worker.ts`), and resolves the sync-server URL
  (`src/main.tsx`). This bundle is what runs in the browser: both the standalone
  PWA and the copy embedded in the desktop host and served to LAN guests. Owns
  mic capture. Has the Playwright e2e suite.
- **`apps/electron-client`** — the desktop **host**. Embeds the web-client bundle,
  runs an embedded Automerge **sync server** on port `9001` (http/ws, or https/wss
  with a self-signed cert), manages TLS certs (`src/certManager.ts`,
  `src/syncServerRuntime.ts`), and drives native audio (SoX, `switchaudio-osx`).
  Packaged/signed/notarized via Electron Forge.
- **`apps/api`** — standalone NestJS Automerge sync server (an alternative/remote
  sync backend). WebSocket gateway with a filesystem-backed Automerge repo
  (`src/sync/sync.gateway.ts`), `helmet`, and a JWT ws guard (`src/auth/`, currently
  commented out in `app.module.ts`). Port `3031`.
- **`apps/web`** — Next.js 16 marketing/landing site (port `3002`). Currently boilerplate.
- **`apps/docs`** — Next.js 16 docs site (port `3001`). Currently boilerplate.
- **`packages/eslint-config`, `packages/tailwind-config`, `packages/typescript-config`** —
  shared config.

**Toolchain:** Yarn 4.17.1 (Berry, node-modules linker) · Node 24.18.0 (`.nvmrc`) ·
Turborepo · Changesets (versioning) · Renovate (deps) · Prettier. CI runs
build/lint/typecheck + `@tapes-monorepo/core` unit tests + `web-client` Playwright e2e.

## Goal

Replace the boilerplate with accurate, maintainable documentation so a new
contributor can understand the product and get it running, without inventing new
tooling or a docs pipeline. Scope is intentionally **READMEs + a few root docs**,
not a built-out `apps/docs` site (tracked as a follow-up).

## Scope (deliverables)

1. **Root `README.md`** — the single source of truth. Rewrite to cover:
   - What Tapes is (local-first audio recording, LAN sync via Automerge).
   - Monorepo layout table (apps + packages, one line each, with dev ports).
   - An architecture / data-flow section (host ↔ guest ↔ sync server), ideally a
     Mermaid diagram.
   - Prerequisites (Node 24 via `.nvmrc`/corepack, Yarn 4, macOS caveat for the
     full recording flow: `ipconfig getifaddr en0`, SoX, `switchaudio-osx`).
   - Getting started: `corepack enable` → `yarn` → `yarn dev` (and when to use
     `yarn dev:https`). Table of root scripts (`dev`, `dev:https`, `build`, `lint`,
     `check-types`, `test`, `format`, `clean`).
   - The local-HTTPS / secure-context story and why it's needed for mic on LAN.
   - Versioning (Changesets: how to add a changeset) and a CI overview.
   - Link out to each app/package README.
2. **Per-app READMEs** — replace boilerplate in `apps/api`, `apps/web`,
   `apps/docs`, `apps/web-client`, and add `apps/electron-client/README.md`. Each:
   purpose, how it fits the architecture, dev command + port, required env vars,
   app-specific gotchas. Specifically document:
   - `apps/api`: Automerge sync server, port `3031`, the dev-HTTPS cert step
     (`localhost-key.pem` + `localhost-cert.pem` via `yarn workspace api cert`),
     that the auth module is currently disabled, and that CI excludes its Jest suite.
   - `apps/electron-client`: host role, embedded sync server on `9001`, dotenvx
     `.env.local`/`.env`, `stage-web-client`, `get-bin`, packaging/notarization env
     (`APPLE_*`, `REPO_OWNER`/`REPO_NAME`).
   - `apps/web-client`: mounts `@tapes-monorepo/core`, `HTTPS`/`LOCAL_NETWORK_IP`/
     `VITE_SYNC_SERVER_URL`, the `/sync` Vite proxy, Playwright e2e.
3. **Per-package READMEs** — replace `packages/core` stub; add short READMEs for
   `packages/ui`, `packages/tailwind-config`, `packages/typescript-config`
   (eslint-config already has one — verify/refresh).
4. **`CONTRIBUTING.md`** (root) — branch/PR workflow, running lint/typecheck/tests
   locally to match CI, how to add a changeset, code style (Prettier), commit
   conventions (semantic commits per Renovate config).
5. **`.env.example` files** — committed, documented placeholders for
   `apps/api`, `apps/web-client`, `apps/electron-client` (values git-ignored; only
   examples committed). Mirror the vars listed above.
6. **`CLAUDE.md`** (root) — short orientation for AI agents/Claude Code: repo
   layout, key commands, the macOS/HTTPS gotchas, and the CI test scoping. Keep it
   concise and pointer-heavy (link to READMEs rather than duplicating).

### Out of scope (follow-ups)

- Building out the `apps/docs` Next.js site into a real documentation site.
- Adding a `LICENSE` (needs an owner decision on license choice).
- Fixing the `api` cert filename mismatch in code — done separately in
  [#260](https://github.com/phonofidelic/tapes-monorepo/pull/260), which aligns
  `main.ts` on `localhost-cert.pem`. The docs describe the corrected behavior.
- API endpoint / IPC channel reference documentation (larger, can follow once the
  auth module is re-enabled).

## Acceptance criteria

- [ ] Root `README.md` no longer references "Turborepo starter", pnpm, or `@repo/ui`,
      and accurately describes Tapes, the monorepo layout, architecture, and how to
      run it.
- [ ] Every app and package under `apps/*` and `packages/*` has a README describing
      its purpose, dev command, port, and env vars (no remaining framework boilerplate).
- [ ] `CONTRIBUTING.md` exists and documents the lint/typecheck/test/changeset flow
      that matches CI.
- [ ] `.env.example` exists for `api`, `web-client`, and `electron-client` with every
      required variable documented.
- [ ] `CLAUDE.md` exists at the repo root.
- [ ] The macOS-only assumptions and the local-HTTPS requirement (including the
      `api` dev-HTTPS cert step) are explicitly documented.
- [ ] `yarn format` passes (docs are Prettier-clean) and no code behavior changes.

## Implementation notes

- **Reuse, don't invent.** All facts above come from existing files — cross-check
  each README against the actual `package.json` scripts and source before writing,
  so docs don't drift on day one.
- Keep per-app READMEs short and link back to the root README for shared setup
  (avoid duplicating the getting-started steps in every file).
- Use a Mermaid diagram in the root README for the host/guest/sync topology
  (renders on GitHub, no tooling needed).
- Prefer relative links between docs so they work on GitHub and in editors.
- Suggested execution order: (1) root README, (2) CONTRIBUTING, (3) per-app READMEs,
  (4) per-package READMEs, (5) `.env.example` files, (6) CLAUDE.md. These are largely
  independent and could be split into sub-issues per file group if parallelized.

## Verification

- Preview every Markdown file (GitHub-flavored) and confirm Mermaid renders and all
  relative links resolve.
- Follow the root README's getting-started steps from a clean checkout on macOS
  (`corepack enable` → `yarn` → `yarn dev` / `yarn dev:https`) and confirm each
  documented command and port is correct.
- Cross-check every documented script/env var/port against the corresponding
  `package.json` and source file (`apps/api/src/main.ts`, `apps/web-client/src/main.tsx`,
  `apps/web-client/vite.config.ts`, `apps/electron-client/src/syncServer*.ts`).
- Run `yarn format` and `yarn lint`; confirm the tree is clean and no code changed.
