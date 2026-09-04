---
'electron-client': minor
'@tapes-monorepo/core': minor
---

Reclaims blob-store space the refcount can never free. The host now walks its library graph on startup and unlinks objects nothing references — bytes left by a crash between the object write and its ref record, and audio whose recording was deleted by a peer that never reached the host to release it.

Objects younger than 24 hours are always kept, since a recording is uploaded independently of its document arriving. The sweep marks against _every_ library the host has served, not just this device's own, so a guest that brought its own library keeps its audio. A document that will not load abandons the sweep rather than letting an incomplete picture delete live recordings.

Logging reports the hardlink count, because dropping the store's link to an object the user still has in their recordings folder frees no space at all.
