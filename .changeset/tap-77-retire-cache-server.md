---
'electron-client': minor
'@tapes-monorepo/core': minor
---

Removes the `tapes://` scheme and the HTTP cache server on port 9000. Playback on the desktop app now goes through the content-addressed blob store for every recording, new or old.

A recording written before audio moved out of band has a file path but no hash. Playing one now adds its file to the store and writes the descriptor into its document, so the recording is content-addressed from then on. The old path keyed its cache by file path, so renaming a recording lost the cached copy. A hash cannot go stale that way.
