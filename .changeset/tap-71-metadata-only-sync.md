---
'@tapes-monorepo/core': minor
---

Recordings now sync as metadata only. `RecordingData` carries a `blob` descriptor (content hash, size, MIME type, extension) instead of the raw bytes, and the audio itself lives in the sync host's content-addressed store, fetched on demand. `audio` and `mimeType` remain on the type but are read-only and deprecated: Automerge history is append-only, so documents written before this change keep their embedded bytes forever and must go on playing.

Playback resolves in order: legacy embedded bytes, then the device-local cache, then this device's own copy of a recording it made, then a fetch from the host (cached on arrival). `useAudioPlayer` gains `playbackState` so a first-play download shows progress and a failure surfaces instead of silently clearing the player. New `PinProvider`/`usePins` add per-device "keep offline" pins, stored outside the synced document. `App` takes a `blobEndpoint` prop, which each shell resolves; leaving it undefined keeps a standalone client working entirely on-device.

The 50 MB embed cap is gone — recordings above it previously failed to sync with only a console warning.
