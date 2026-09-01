---
'@tapes-monorepo/core': patch
---

Fixes playback on a web guest for a recording made on the electron host. The player's local-copy step handed the recording's `filepath` straight to OPFS, and a host recording's path is an absolute one from that machine's filesystem — `getFileHandle` rejects it with `TypeError: Name is not allowed` rather than reporting a miss, so the guest logged an error where it should simply have moved on to fetching the bytes from the host. The OPFS lookup is now skipped for anything that cannot be a flat OPFS name.
