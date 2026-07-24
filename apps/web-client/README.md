# web-client

The browser surface of [Tapes](../../README.md). A thin Vite + React shell that
mounts the Tapes application (`@tapes-monorepo/core`), runs the Automerge sync
worker, and captures microphone audio.

This same bundle runs in two places:

- **Standalone** in a browser (e.g. the Vercel-hosted PWA).
- **Embedded** in the desktop host (`electron-client`) and served to LAN guests.

The sync-server URL is resolved at runtime in `src/main.tsx`: when served by the
Electron host it's the same origin; in dev it reaches the host's embedded sync
server through the `/sync` proxy (see `vite.config.ts`); a build-time
`VITE_SYNC_SERVER_URL` (the Vercel deploy path) takes precedence.

## Develop

```sh
yarn workspace web-client dev        # http://<lan-ip>:3000
yarn workspace web-client dev:https  # https://<lan-ip>:3000 (needed for mic on LAN)
```

HTTPS is required for microphone access in a secure context on LAN guests; the
`dev:https` script enables TLS via `@vitejs/plugin-basic-ssl`.

## Environment variables

| Variable               | Purpose                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| `HTTPS`                | When `true`, the Vite dev server serves over TLS (set by `dev:https`).       |
| `LOCAL_NETWORK_IP`     | LAN IP, derived from `ipconfig getifaddr en0` (macOS) in the dev scripts.    |
| `VITE_SYNC_SERVER_URL` | Optional build-time override for the sync-server URL (e.g. a Vercel deploy). |

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
