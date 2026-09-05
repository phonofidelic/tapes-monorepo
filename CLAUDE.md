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
- `apps/api` dev HTTPS needs `localhost-key.pem` + `localhost-cert.pem` in
  `apps/api/` — generate them with `yarn workspace api cert`.
- Env files are git-ignored and pulled from Vercel (`yarn ... pull`); committed
  `.env.example` files document the vars.
- CI runs unit tests only for `@tapes-monorepo/core`; the `apps/api` Jest suite is
  excluded (pre-existing compile failure). Don't treat that as a gap to "fix"
  without checking.

## Writing style (PR descriptions, commit bodies, doc comments)

Write for a competent engineer who has not seen this code before and is reading
quickly. Past PRs (#303, #306, #307, #309, #312) are accurate but dense; do not
copy their prose style.

- **Lead with the change.** The first two or three sentences say what changed
  and why, in plain words. A reader who stops there should know what the PR does.
- **Short sentences, one idea each.** Aim for about 20 words. Do not chain
  clauses with em-dashes, semicolons, or parentheses. Start a new sentence.
- **Plain words over clever ones.** Avoid figurative or essayistic phrasing
  ("no second CORS story", "failure posture", "the price of", "worth a reviewer's
  eye", "the traps", "does the real work here"). Say the concrete thing.
- **Give the reason once, where it matters.** Not every sentence needs a
  "so that" or "which is what lets". Explain the non-obvious decisions; skip
  the obvious ones.
- **Do not use ticket numbers as nouns.** "TAP-98's index" means nothing to a
  reader without Linear open. Name the thing: "the per-device dedupe index".
  Link the ticket once at the top.
- **At most one code identifier per sentence.** Describe the rest in words.
  A sentence with four backticked names is a list, not a sentence.
- **Bullets are one or two sentences.** If a bullet needs a paragraph, it is a
  section. Bold the first few words of a bullet, never a whole sentence.
- **Use a predictable shape:** *What changed* / *Why* / *How it was tested* /
  *Notes or known limits*. Test results go in a short list or table, not prose.
- **Length.** A typical PR body fits in about 250 words. Longer is fine only
  when the change is genuinely large; then use the section headers above.

Doc comments follow the same rules, with two additions:

- A module header says what the module does and the one or two constraints a
  reader must know before editing it. Keep it under roughly eight lines. It is
  not a copy of the PR description.
- Put the reasoning next to the code it explains, as a short comment at that
  line, rather than collecting it all in the header.

Example rewrite, from PR #312:

> Before: "Reusing that origin means no new port, no second CORS story, and
> nothing further to configure — guests already reach it and already hold the
> token."
>
> After: "The route shares the existing HTTP origin and pairing token, so
> guests need no extra configuration."
