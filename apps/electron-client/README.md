# electron-client

The [Tapes](../../README.md) desktop app, and the sync **host** for the local
network. Built with [Electron Forge](https://www.electronforge.io/) and Vite.
Guests on the LAN pair with it and sync through it.

It does three things:

1. **Renders the Tapes app.** The renderer in `src/renderer.tsx` mounts the
   shared app from core, the same app the browser web-client runs.
2. **Runs the embedded Automerge sync server** that LAN guests connect to. It
   lives in `src/syncServer.ts` and listens on port `9001` by default. It serves
   plain HTTP and WebSocket unless LAN HTTPS is enabled. With HTTPS on, it
   generates a self-signed certificate with the LAN IP in its SAN, using the
   `selfsigned` package, and persists it under the user data directory in
   `sync-tls`. See `src/certManager.ts` and `src/syncServerRuntime.ts`.
3. **Drives native audio.** Recording shells out to
   [SoX](https://sourceforge.net/projects/sox/). Input selection uses
   [`switchaudio-osx`](https://github.com/deweller/switchaudio-osx). Both are
   **macOS** binaries fetched by `yarn get-bin`, and the IPC channels in
   `src/channels/` call them.

## Develop

```sh
yarn workspace electron-client get-bin       # once: download the native audio binaries
yarn workspace electron-client dev           # host and guest url over http
yarn workspace electron-client dev:https     # host advertises https://<lan-ip>:3000 to guests
```

The dev scripts set `WEB_CLIENT_DEV_URL` from the machine's LAN IP, read with
`ipconfig getifaddr en0` on macOS. They load env through
[dotenvx](https://dotenvx.com/) from `.env.local`. Prefer running the whole
stack from the repo root with `yarn dev` or `yarn dev:https`.

## Packaging

```sh
yarn workspace electron-client stage-web-client   # build web-client and copy it into ./web-client
yarn workspace electron-client package            # build the app bundle without installers
yarn workspace electron-client make               # build a distributable
yarn workspace electron-client publish            # build and publish a release
```

Packaging loads env from `.env`, not `.env.local`.

## Tests

Unit tests use Vitest and run in CI:

```sh
yarn workspace electron-client test
```

### End-to-end tests

```sh
yarn workspace electron-client get-bin   # once: sox and switchaudio-osx
yarn workspace electron-client e2e
```

Playwright launches the **packaged** app and records through the real renderer.
It then follows the audio out the far end: into the blob store, onto the
recording's Automerge document as a blob descriptor, and down to a browser guest
that fetches it by hash. The reverse leg is covered too. A guest records, and the
renderer plays it back from its own embedded store. See
[`e2e/renderer.spec.ts`](./e2e/renderer.spec.ts).

Notes on running it:

- **macOS only, and it needs a working audio input.** Recording shells out to
  sox, which no browser flag can fake. Without an input device the suite skips
  itself with a reason. On CI, where a virtual device is set up on purpose, it
  fails outright instead.
- **The first run packages the app,** which takes minutes. The build lands in
  `out-e2e/`, separate from the normal output directory, because it re-enables
  the node inspector fuse that Playwright needs and must never be shipped.
  Later runs reuse it. Delete `out-e2e/` to rebuild.
- **The app under test is isolated.** It runs against a throwaway user data
  directory, so it never touches your own library, and binds port `9102`
  rather than the usual `9001`.
- **It does not run on pull requests.** A nightly macOS job in
  [`e2e-electron.yml`](../../.github/workflows/e2e-electron.yml) runs it. It
  can also be triggered by hand from the Actions tab.

## Environment variables

Pull dev env from Vercel with `yarn workspace electron-client pull`. It writes
`.env.local`. See [`.env.example`](./.env.example).

| Variable                                      | Purpose                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                    | Toggles dev versus packaged code paths and binary locations.                                  |
| `WEB_CLIENT_DEV_URL`                          | Url of the web-client dev server the host loads. Set by the dev scripts.                      |
| `VITE_SYNC_SERVER_URL`                        | Optional sync server url override in the renderer.                                            |
| `TAPES_SYNC_SERVER_PORT`                      | Pins the embedded server's port instead of `9001`. Used by the e2e suite.                     |
| `TAPES_E2E`                                   | Marks a build or run as the e2e suite's. Skips the auto-updater and packages into `out-e2e/`. |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | macOS code signing and notarization. Packaging only.                                          |
| `REPO_OWNER`, `REPO_NAME`                     | GitHub publish target. Packaging only.                                                        |
