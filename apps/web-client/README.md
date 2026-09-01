# web-client

The browser surface of [Tapes](../../README.md). A thin Vite + React shell that
mounts the Tapes application (`@tapes-monorepo/core`), runs the Automerge sync
worker, and captures microphone audio.

This same bundle runs in two places:

- **Standalone** in a browser (e.g. the Vercel-hosted PWA).
- **Embedded** in the desktop host (`electron-client`) and served to LAN guests.

The sync-server URL is resolved at runtime in `src/main.tsx`: it is always
`/sync` on the origin serving the bundle. The Electron host accepts the socket
upgrade on any path, and in dev the Vite dev server proxies `/sync` back to that
host (see `vite.config.ts`). A build-time `VITE_SYNC_SERVER_URL` (the Vercel
deploy path) takes precedence.

## Develop

```sh
yarn workspace web-client dev        # http://<lan-ip>:3000
yarn workspace web-client dev:https  # https://<lan-ip>:3000 (needed for mic on LAN)
```

HTTPS is required for microphone access in a secure context on LAN guests; the
`dev:https` script enables TLS via `@vitejs/plugin-basic-ssl`.

## PWA

The standalone build is an installable, offline-capable PWA
(`vite-plugin-pwa`, configured in `vite.config.ts`).

**The Automerge WebAssembly module must stay precached.** The bundle fetches
that ~3.2 MB asset at module-init time under a top-level await, so if it is
missing the app installs, launches offline and then never mounts — only a
useless shell. Workbox excludes it under its own defaults twice over (`wasm` is
not in the default `globPatterns`, and the default 2 MiB size cap would drop it
anyway), so `vite.config.ts` overrides both and
`scripts/verifyPrecache.mjs` fails the build if it ever falls back out of the
generated manifest.

The service worker is **off in two places**:

- **In dev**, so it can't fight the LAN-guest HMR flow or the Playwright suite,
  which runs against the dev server by design.
- **In a host-served build** (`VITE_SERVED_BY_HOST`), because a LAN guest exists
  to sync with a live Electron host: plain-HTTP LAN mode isn't a secure context
  so a worker couldn't register there at all, and the HTTPS mode's self-signed
  cert makes a wedged worker painful to clear. `src/main.tsx` also unregisters
  any worker a guest picked up before this was true.

Updates are **prompted, never silent** (`src/PwaUpdatePrompt.tsx`): a new deploy
installs in the background and waits, rather than swapping the bundle out from
under a recording in progress.

### Icons

Everything in `public/` is exported from the **Tapes App Icons** Figma document
([file `GiDQCS5RTxysuqxluAV9Xs`](https://www.figma.com/design/GiDQCS5RTxysuqxluAV9Xs/Tapes-App-Icons)),
one frame per file:

| File                            | Figma frame                |
| ------------------------------- | -------------------------- |
| `icon.svg`                      | `pwa-512x512` (as vector)  |
| `pwa-512x512.png`               | `pwa-512x512`              |
| `maskable-icon-512x512.png`     | `maskable-icon-512x512`    |
| `pwa-192x192.png`               | `pwa-192x192`              |
| `pwa-64x64.png`                 | `pwa-64x64`                |
| `apple-touch-icon-180x180.png`  | `apple-touch-icon-180x180` |
| `favicon-32.png`                | `favicon-32`               |
| `favicon-16.png`                | `favicon-16`               |

Re-export from Figma when the artwork changes — **don't** regenerate the PNGs
from `icon.svg`. The sizes are tuned individually in the design file, and the
maskable variant especially is not just a rescale: it carries much more padding
so the mark survives Android's circular crop. Any generate-from-one-source
pipeline flattens that distinction.

There is deliberately no `favicon.ico`; the SVG plus the two favicon PNGs are
declared explicitly in `index.html`, so no browser falls back to probing
`/favicon.ico`.

## Environment variables

| Variable               | Purpose                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `HTTPS`                | When `true`, the Vite dev server serves over TLS (set by `dev:https`).                         |
| `LOCAL_NETWORK_IP`     | LAN IP, derived from `ipconfig getifaddr en0` (macOS) in the dev scripts.                      |
| `VITE_SYNC_SERVER_URL` | Optional build-time override for the sync-server URL (e.g. a Vercel deploy).                   |
| `VITE_SERVED_BY_HOST`  | Set by electron-client's `stage-web-client`: the host serves this bundle, so no PWA packaging.  |

Env values are pulled from Vercel with `yarn workspace web-client pull` (writes
`.env.local`). See [`.env.example`](./.env.example) for the documented set.

## Testing

End-to-end tests use [Playwright](https://playwright.dev/) (Chromium):

```sh
yarn workspace web-client e2e      # headless
yarn workspace web-client e2e:ui   # interactive
```

The suite exercises mic capture and device switching, so it needs an audio input
device; CI provides one via a virtual PulseAudio source (see
`.github/workflows/ci.yml`).

Three projects, on three servers. `chromium` runs against the dev server; `pwa`
(`e2e/pwa.spec.ts`) against `vite preview`, since the service worker only exists
in a built bundle; and `two-device` (`e2e/two-device.spec.ts`) against a second
dev server whose `/sync` and `/blobs` are proxied to a real host. Run one with:

```sh
yarn workspace web-client e2e --project=pwa
```

### The two-device project

`two-device` is the host↔guest suite: pairing over the QR url, a guest uploading
what it records, a guest playing a tape it never recorded, per-device caching and
pinning, and `Range` requests to a real `<audio>` element.

The host is the electron client's own embedded sync server (`startSyncServer`),
run headlessly in a child process against a temporary store — no Electron, and
nothing reimplemented. `e2e/host.ts` drives it over stdio; `e2e/hostProcess.ts`
is the far side and explains why it is a separate process. The browser is a
genuine guest: its own origin and OPFS, holding only the pairing url it was
handed.

Two knobs it relies on: `TAPES_SYNC_SERVER_PORT` retargets the dev server's
`/sync` and `/blobs` proxies away from the desktop app's `9001` (see
`vite.config.ts`), and the host binds `9101` so a running desktop app is never
in the way.
