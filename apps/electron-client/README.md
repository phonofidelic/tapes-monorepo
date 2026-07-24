# electron-client

The [Tapes](../../README.md) desktop app — and the sync **host** for the local
network. Built with [Electron Forge](https://www.electronforge.io/) + Vite.

It does three things:

1. **Renders the Tapes app.** The renderer (`src/renderer.tsx`) mounts
   `@tapes-monorepo/core`, the same app the browser `web-client` runs.
2. **Runs the embedded Automerge sync server** (`src/syncServer.ts`,
   `DEFAULT_SYNC_SERVER_PORT = 9001`) that LAN guests connect to. It serves plain
   `http`/`ws` by default, or `https`/`wss` when LAN HTTPS is enabled — in which
   case a self-signed certificate (via the `selfsigned` package, LAN IP in the
   SAN) is generated and persisted under `userData/sync-tls`
   (`src/certManager.ts`, `src/syncServerRuntime.ts`).
3. **Drives native audio.** Recording shells out to [SoX](https://sourceforge.net/projects/sox/)
   and input selection uses [`switchaudio-osx`](https://github.com/deweller/switchaudio-osx)
   (`src/channels/`). These are **macOS** binaries fetched by `yarn get-bin`.

## Develop

```sh
yarn workspace electron-client get-bin       # once: download the native audio binaries
yarn workspace electron-client dev           # host + guest URL over http
yarn workspace electron-client dev:https     # host advertises https://<lan-ip>:3000 to guests
```

`dev`/`dev:https` set `LOCAL_NETWORK_IP` and `WEB_CLIENT_DEV_URL` from
`ipconfig getifaddr en0` (macOS) and load env via
[dotenvx](https://dotenvx.com/) from `.env.local`. Prefer running the whole stack
from the repo root with `yarn dev` / `yarn dev:https`.

## Packaging

```sh
yarn workspace electron-client stage-web-client   # build web-client and copy into ./web-client
yarn workspace electron-client make               # build a distributable
yarn workspace electron-client publish            # build and publish a release
```

Packaging loads env from `.env` (not `.env.local`) via dotenvx.

## Environment variables

Dev env is pulled from Vercel with `yarn workspace electron-client pull` (writes
`.env.local`). See [`.env.example`](./.env.example).

| Variable                                      | Purpose                                                             |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `NODE_ENV`                                    | Toggles dev vs. packaged code paths and binary locations.           |
| `WEB_CLIENT_DEV_URL`                          | URL of the `web-client` dev server the host loads (set by scripts). |
| `LOCAL_NETWORK_IP`                            | LAN IP (macOS `ipconfig getifaddr en0`).                            |
| `VITE_SYNC_SERVER_URL`                        | Optional sync-server URL override in the renderer.                  |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | macOS code-signing / notarization (packaging only).                 |
| `REPO_OWNER`, `REPO_NAME`                     | GitHub publish target (packaging only).                             |
