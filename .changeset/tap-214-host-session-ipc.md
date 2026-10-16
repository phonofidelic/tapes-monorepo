---
'@tapes-monorepo/core': minor
'electron-client': minor
---

The desktop renderer can now start and stop a host session over IPC, and read the open one. The new channels are `session:start`, `session:stop` and `session:get-current`. The host makes the session ID.

The open session is published in the root document's new `session` field, with its start time. Stopping clears it. Only the host's main process writes the field. When the host starts, it clears a field left behind by a crash.
