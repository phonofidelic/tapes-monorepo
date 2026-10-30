---
'@tapes-monorepo/sync-protocol': minor
'@tapes-monorepo/core': minor
---

A host now turns away a sync socket from a device key it knows to be revoked.

The check runs on the upgrade, against the host's own roster. That roster holds every vouch the host signed and the revocation once its operator withdrew one, so it answers by device key. A host that has seen no revocation for a key still lets the device in.

The refusal reaches the guest as the new `SYNC_CLOSE_REVOKED` close code, because a browser reports a turned-down upgrade as a bare error. `HostConnection` gains `isRevoked`, `useHostConnection` gains a `revoked` state, and the session strip says so instead of showing a host that never comes up.
