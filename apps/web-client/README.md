# web-client

The browser shell of [Tapes](../../README.md). It is a small Vite and React app
that mounts the shared Tapes application from `@tapes-monorepo/core`, runs the
Automerge sync connection, and captures microphone audio. The same bundle runs
standalone in a browser, as the Vercel-hosted PWA, and embedded in the desktop
host, which serves it to LAN guests.

## Where it syncs

The sync server url is resolved at runtime in `src/main.tsx`. The first match
wins:

1. A build-time `VITE_SYNC_SERVER_URL`. This is the Vercel deploy path.
2. A remote server the user entered in Settings, read from localStorage.
3. In development, same-origin `/sync`. The Vite dev server proxies it to the
   Electron host's embedded sync server.
4. In a host-served build, same-origin `/sync`. The host accepts the socket
   upgrade on any path.
5. Nothing matched. The app runs local-only with IndexedDB storage.

The dev server also proxies `/blobs` and `/events` to the host. All three
proxies target port `9001` unless `TAPES_SYNC_SERVER_PORT` says otherwise. See
`vite.config.ts`.

## Develop

```sh
yarn workspace web-client dev        # http://<lan-ip>:3000
yarn workspace web-client dev:https  # https://<lan-ip>:3000
```

Microphone access needs a secure context, so LAN guests need HTTPS. The
`dev:https` script turns on TLS through the basic-ssl Vite plugin.

## PWA

The standalone build is an installable, offline-capable PWA. The plugin is
`vite-plugin-pwa`, configured in `vite.config.ts`.

**The Automerge WebAssembly module must stay precached.** The bundle fetches
that asset, about 3.2 MB, at module-init time under a top-level await. If it is
missing from the cache, the app installs and launches offline but never mounts.
Workbox would exclude it twice over by default: `wasm` is not in the default
glob patterns, and the default 2 MiB size cap would drop it anyway. The Vite
config overrides both. The `build` script then runs `scripts/verifyPrecache.mjs`,
which fails the build if the module ever falls out of the generated manifest.

The service worker is off in two places:

- **In development,** so it cannot interfere with the LAN-guest HMR flow or the
  Playwright suite, which runs against the dev server on purpose.
- **In a host-served build,** flagged by `VITE_SERVED_BY_HOST`. A LAN guest
  exists to sync with a live Electron host. Plain-HTTP LAN mode is not a secure
  context, so a worker could not register there at all. In HTTPS mode the
  self-signed cert makes a wedged worker painful to clear. The entry point also
  unregisters any worker a guest picked up before this rule existed.

Updates are prompted, never silent. A new deploy installs in the background and
waits for the user, so the bundle is never swapped out under a recording in
progress. See `src/PwaUpdatePrompt.tsx`.

### Icons

The icons in `public/` are exported from the **Tapes App Icons** Figma document
([file `GiDQCS5RTxysuqxluAV9Xs`](https://www.figma.com/design/GiDQCS5RTxysuqxluAV9Xs/Tapes-App-Icons)),
one frame per file:

| File                           | Figma frame                |
| ------------------------------ | -------------------------- |
| `icon.svg`                     | `pwa-512x512` (as vector)  |
| `pwa-512x512.png`              | `pwa-512x512`              |
| `maskable-icon-512x512.png`    | `maskable-icon-512x512`    |
| `pwa-192x192.png`              | `pwa-192x192`              |
| `pwa-64x64.png`                | `pwa-64x64`                |
| `apple-touch-icon-180x180.png` | `apple-touch-icon-180x180` |
| `favicon-32.png`               | `favicon-32`               |
| `favicon-16.png`               | `favicon-16`               |

When the artwork changes, re-export from Figma. Do not regenerate the PNGs from
the SVG. Each size is tuned by hand in the design file. The maskable variant in
particular carries much more padding so the mark survives Android's circular
crop, and a generate-from-one-source pipeline would flatten that.

There is deliberately no `favicon.ico`. The SVG and the two favicon PNGs are
declared explicitly in `index.html`, so no browser falls back to probing for one.

## Environment variables

| Variable               | Purpose                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `HTTPS`                | When `true`, the Vite dev server serves over TLS. Set by `dev:https`.                        |
| `VITE_SYNC_SERVER_URL` | Optional build-time sync server url, for example a Vercel deploy.                            |
| `VITE_SERVED_BY_HOST`  | Set by the electron-client's `stage-web-client` script. The host serves this bundle, no PWA. |

Pull env values from Vercel with `yarn workspace web-client pull`. It writes
`.env.local`. See [`.env.example`](./.env.example) for the documented set.

## Testing

Unit tests use Vitest and run in CI:

```sh
yarn workspace web-client test
```

End-to-end tests use [Playwright](https://playwright.dev/) with Chromium:

```sh
yarn workspace web-client e2e      # headless
yarn workspace web-client e2e:ui   # interactive
```

The suite exercises mic capture and device switching, so it needs an audio
input device. CI provides one through virtual PulseAudio sources. See
`.github/workflows/ci.yml`.

There are three Playwright projects, each on its own server:

- **`chromium`** runs against the dev server.
- **`pwa`** runs `e2e/pwa.spec.ts` against `vite preview`, because the service
  worker only exists in a built bundle.
- **`two-device`** runs `e2e/two-device.spec.ts` against a second dev server
  whose proxies point at a real host.

Run one project with:

```sh
yarn workspace web-client e2e --project=pwa
```

### The two-device project

This is the host and guest suite. It covers pairing over the QR url, a guest
uploading what it records, a guest playing a tape it never recorded, per-device
caching and pinning, and range requests from a real audio element.

The host is the electron client's own embedded sync server, run headless in a
child process against a temporary store. No Electron, and nothing reimplemented.
The test process drives it over stdio through `e2e/host.ts`. The far side is
`e2e/hostProcess.ts`, which explains why it has to be a separate process. The
browser is a genuine guest with its own origin and OPFS, holding only the
pairing url it was handed.

The suite relies on two ports. The host binds `9101`, so a running desktop app
on `9001` is never in the way. `TAPES_SYNC_SERVER_PORT` retargets the guest dev
server's proxies to that port.
