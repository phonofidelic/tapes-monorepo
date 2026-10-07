# @tapes-monorepo/core

The Tapes application itself. This is the shared code that both shells mount:
the browser web-client and the desktop electron-client renderer. The UI lives in
`app/`, with the root component, views, components and React contexts.

The package owns:

- **The app tree.** Each shell builds its own Automerge repo, because storage
  and networking are platform-specific. The shell passes the repo to
  `Providers` and renders `App` inside it. The web client persists to IndexedDB
  and the electron renderer delegates persistence to the embedded sync server.
  Core reads the repo through `@automerge/automerge-repo-react-hooks`.
- **Blob and event clients.** Recorded audio is sent to and fetched from the
  hosts the shell resolves. Playback events are queued and flushed to the one
  host that owns the library's numbers.
- **LAN pairing.** QR codes from `qrcode.react` let guest devices join the host.
- **Talking to the Electron host** through `IpcService`.

It is built as a library with
[Vite](https://vite.dev/guide/build#library-mode). Consumers import it
through the package exports, `.` for the code and `./style.css` for the styles.

## Scripts

```sh
yarn workspace @tapes-monorepo/core build       # vite build
yarn workspace @tapes-monorepo/core dev         # vite build --watch
yarn workspace @tapes-monorepo/core test        # vitest run
```

The `dev:https` script is an alias of `dev`. The package builds the same either
way, and the shells that consume it decide the protocol. The unit tests run in
CI alongside those of electron-client and web-client.
