---
'@tapes-monorepo/core': minor
---

Queues finished play sessions on the device and flushes them to the host that owns the recording's library. A play now survives being offline and survives a reload.

The queue lives in device storage, not in the Automerge doc, so one phone's pending sends are not synced to every peer. It is kept per host and capped at the host's batch size, so a full queue always fits in one request.

The queue clears itself against the host's per-event answer. Accepted, duplicate and non-retryable events are dropped. Everything else stays, including an event whose recording has not finished syncing to the host. Retries to an unreachable host back off from five seconds to five minutes. Flushes also run on reconnect, on returning to the foreground, on pairing, and when a play finishes.
