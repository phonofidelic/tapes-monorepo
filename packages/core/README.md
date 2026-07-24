# @tapes-monorepo/core

The **Tapes application** itself — the shared code that runs in both the browser
(`web-client`) and the desktop host (`electron-client`).

The UI lives in `app/` (`App.tsx`, `views/`, `components/`, `context/`). This
package owns:

- **Sync** — the Automerge repo (`@automerge/automerge-repo`) with **IndexedDB**
  storage in the browser and **WebSocket + BroadcastChannel** networking, exposed
  to React via `@automerge/automerge-repo-react-hooks`.
- **LAN pairing** — QR codes (`qrcode.react`) so guest devices can join the host.
- Communication with the Electron host through `IpcService`.

It's built as a library with [`vite-plus`](https://www.npmjs.com/package/vite-plus)
and consumed via its package exports (`.` and `./style.css`).

## Scripts

```sh
yarn workspace @tapes-monorepo/core build       # vp build
yarn workspace @tapes-monorepo/core dev         # vp build --watch (http protocol)
yarn workspace @tapes-monorepo/core dev:https   # vp build --watch (https protocol)
yarn workspace @tapes-monorepo/core test        # vitest run
```

The `dev`/`dev:https` scripts set `VITE_LOCAL_NETWORK_IP` (from macOS
`ipconfig getifaddr en0`) and `VITE_LOCAL_NETWORK_PROTOCOL`. This is the package
whose unit tests run in CI.
