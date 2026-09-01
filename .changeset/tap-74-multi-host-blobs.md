---
'@tapes-monorepo/core': minor
---

Recorded audio now resolves against every host this device is paired with rather than a single one. `resolveBlobEndpoint` becomes `resolveBlobEndpoints` and returns an ordered list — the embedded host first, then the page origin, then a configured remote — and `App` takes `blobEndpoints` in place of `blobEndpoint`. Playback and pinning fetch through `fetchBlobFromAny`, which treats a 404 as "ask the next host", and then quietly copy the bytes to the hosts that were missing them (`replicateBlob`), so a recording does not stay playable only while one particular machine is awake. Deleting releases the claim on every non-local host.

This is what the desktop app needed to work in `syncServerMode: 'remote'`: it syncs docs whose hashes its own store has never seen, and used to 404 against itself with nowhere else to look. It can now store a `pairingToken` for that remote host — there is a field for it in Sync settings — which opens both the remote socket and its `/blobs` surface. The "keep offline" pin control, previously hidden on electron outright, is now gated on whether any host other than this device's own disk is in play, so a remote-mode desktop gets it and an ordinary host still does not.
