---
'@tapes-monorepo/core': minor
---

The pairing link a host hands a guest is now only ever its own LAN URL. It previously fell back to the deployed web-client whenever the host had no `lanWebAppUrl` — while still appending `pt=<pairing token>`, publishing a credential for the host's sync socket and `/blobs` on an origin that cannot reach it. That was reachable in ordinary use: between enabling LAN sharing and the refreshed server info arriving, and whenever `ipconfig getifaddr en0` is empty. `guestUrl` now requires `lanWebAppUrl`. Development is unaffected — the host already advertises the dev server as `lanWebAppUrl` (see `webClientDevUrl`).

Two more defects in the same link: the token was read from a stale closure, so a fresh host's first link carried no `pt` and no guest could join it; and that same write overwrote the `pairingToken` setting, which holds the token for a *remote* host, discarding a saved pairing on every trip through embedded mode.

Sync settings are consolidated into `SyncSettings` — server mode, the LAN and HTTPS toggles, the QR, and the import field — leaving audio and storage in `Settings`.
