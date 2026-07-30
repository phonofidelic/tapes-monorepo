---
'@tapes-monorepo/core': minor
---

Adds the client half of out-of-band audio storage, ahead of recordings actually using it. `blobClient` (`uploadBlob`/`fetchBlob`/`headBlob`/`deleteBlob`/`resolveBlobEndpoint`) talks to the sync host's new `/blobs` surface, and `callWorker` gives the web-client's storage worker a request/response helper with correlated ids so overlapping requests can no longer take each other's replies. `BlobDescriptor` is exported from `types`, and `SyncServerInfo` gains `blobBaseUrl`, `lanBlobBaseUrl` and `blobToken`. Nothing reads or writes these yet: `RecordingData` is unchanged and recordings still embed their audio.
