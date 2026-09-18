---
'@tapes-monorepo/core': minor
---

Adds `probeBlobEndpoints` to the blob client. It walks the configured hosts with HEAD requests and returns the first one holding the blob, along with the size and content type that host reported. `fetchBlobFromAny` does the same host selection but also downloads the body, which streaming playback does not need.

Failures are collected per host and classified with `classifyBlobFailure`, the same taxonomy the whole-body fetch uses. A host that rejected our token still outranks one that simply lacks the bytes, so the player keeps showing the four distinct failure messages.

`headBlob` now takes an abort signal and a response timeout, sharing the deadline helper with `fetchBlob`. A host that accepts a connection and then goes quiet fails over instead of stalling. `blobUrl` is exported so a player can build a streaming source.

Nothing calls the new function yet, so there is no user-visible change.
