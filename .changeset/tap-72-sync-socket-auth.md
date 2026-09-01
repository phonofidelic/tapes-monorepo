---
'@tapes-monorepo/core': minor
---

The embedded sync socket now requires the pairing token. The token minted in `sync-server.json` is no longer only a `/blobs` credential, so it is renamed `pairingToken` throughout (`SyncServerInfo.blobToken` -> `pairingToken`), and the host verifies it on the websocket upgrade with the same timing-safe comparison the blob routes use — accepting it as `Authorization: Bearer` or, since a browser cannot set headers on a `WebSocket`, as `?t=`.

Previously anyone who could reach the host's port could join the repo and read or rewrite the whole library. Both clients now present the token: the web client on the same-origin `/sync` URL (never on a remote or build-time server, which is a different deployment with a different secret), and the Electron renderer on the embedded server's URL. The QR/copy pairing link carries the token as `pt` instead of `bt`.

There is no compatibility window — the check is unconditional. Any device paired against an older dev build simply re-pairs from the QR code.
