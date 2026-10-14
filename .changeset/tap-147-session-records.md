---
'@tapes-monorepo/provenance': minor
'@tapes-monorepo/sync-protocol': minor
'electron-client': minor
'web-client': minor
---

The desktop host can now sign a session record. The record lists the device keys that were connected during the session, with their join and leave times. It also lists the recording claims the host verified for the session. The record is stored in the blob store and owned by the library's root document. Blob GC keeps it while that root document is live.

A guest proves it holds its device key when it opens the sync socket. It fetches a one-time challenge from the host's new `/challenge` route, signs it, and sends the proof on the upgrade request. A connection without a valid proof is still served, but it is left out of session records. The host's own window is listed under the host key.

The provenance package adds `createSessionRecord`, `checkSessionRecord`, `createSyncProof` and `checkSyncProof`. The sync protocol package adds the challenge path and the proof parameter.

Sessions are opened and closed from host code only. The start and stop control comes later.
