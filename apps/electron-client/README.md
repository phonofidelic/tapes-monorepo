# electron-client

The [Tapes](../../README.md) desktop app, and the sync **host** for the local
network. Built with [Electron Forge](https://www.electronforge.io/) and Vite.
Guests on the LAN pair with it and sync through it.

It does three things:

1. **Renders the Tapes app.** The renderer in `src/renderer.tsx` mounts the
   shared app from core, the same app the browser web-client runs.
2. **Runs the embedded Automerge sync server** that LAN guests connect to. It
   lives in `src/syncServer.ts` and listens on port `9001` by default. It serves
   plain HTTP and WebSocket unless LAN HTTPS is enabled. See
   [LAN HTTPS and guest trust](#lan-https-and-guest-trust) for what turning that
   on involves.
3. **Drives native audio.** Recording shells out to
   [SoX](https://sourceforge.net/projects/sox/). Input selection uses
   [`switchaudio-osx`](https://github.com/deweller/switchaudio-osx). Both are
   **macOS** binaries fetched by `yarn get-bin`, and the IPC channels in
   `src/channels/` call them.

## LAN HTTPS and guest trust

Browsers only expose the microphone and OPFS in a secure context. A guest on the
LAN cannot record over plain HTTP, so the host serves the sync server over HTTPS
once LAN HTTPS is turned on in Settings.

There is no public name to get a certificate for, so the host issues its own. It
mints a root certificate once per install and never rotates it on its own. The
server certificate is issued from that root and re-issued when the LAN IP
changes. Both live under `sync-tls` in the user data directory. See
`src/certManager.ts`.

### The two ways a guest can trust the host

A guest either installs the root once on their device, or clicks through the
browser warning. Both work, and both are supported. Installing a root on a phone
is a real ask, and some guests will decline.

What each one gives you:

- **Both encrypt the connection.** Nobody on the network can read the traffic,
  including the pairing token.
- **Only the installed root proves which machine answered.** Clicking through
  accepts whatever certificate arrived. Another machine on the LAN could serve
  its own and the warning would look the same.

### When the warning comes back

With the root installed, it does not. That is the point of the root. The guest
keeps trusting every server certificate the host issues afterwards, including
the ones minted after a LAN IP change.

Without it, the warning returns on every LAN IP change. It also returns whenever
the host mints a new root. Deleting the `sync-tls` directory does that, and every
guest has to trust the host again.

### Checking the fingerprint

The pairing link carries the root's fingerprint. The trust page compares that
value against the certificate the connection actually used and says whether they
match. The fingerprint came off the host's screen, so it is the one thing on that
page a machine on the LAN cannot forge.

The host also shows the fingerprint under Settings, next to the pairing QR code.
That is for a guest who wants to read it off and compare by eye.

### Pointing a guest at the trust page

The host serves two routes for this, both on the same origin as the guest app
and neither behind the pairing token. See `src/caHttp.ts`.

| Route     | Purpose                                                   |
| --------- | --------------------------------------------------------- |
| `/trust`  | A plain page with install steps for the guest's platform. |
| `/ca.crt` | The root certificate itself.                              |

A guest who has opened the pairing link finds the same page linked from their
own Settings screen, as **Install this host's certificate**. Send a guest there
rather than writing out the steps. The page detects the platform and shows the
right ones.

One step catches people out on iOS. Installing the profile is not enough. The
guest must also turn the certificate on under **Settings › General › About ›
Certificate Trust Settings**. Without that the warning looks exactly as it did
before. The trust page says so, and it is worth repeating in person.

Chrome on Android trusts user-installed roots. Firefox on Android does not, so a
Firefox guest is on the click-through path.

### In development

None of the above applies under `yarn dev:https`. Guests load the Vite dev
server, which proxies to the sync server over loopback. The embedded server runs
plain and mints nothing.

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
