---
'electron-client': minor
---

Opens the host's `POST /events` route, where a guest's queued plays land. It sits on the same origin, port and pairing token as `/blobs` — a guest already reaches this host and already holds the token, so there is no new port to open, no second CORS story, and nothing further to configure — and, like the blob routes, is mounted ahead of the static handler so a flush can never be answered by the SPA fallback's 200.

A flush is a batch, so the answer is per event: accepted ids, ids this device had already sent, and rejections carrying the position in the batch, a reason, and whether it is worth retrying. Without that a client could neither safely clear its queue nor safely resend it. Completion is clamped into `[0, 1]` rather than rejected — a 1.02 is a rounding artefact of a play that finished, not a reason to lose the play — and an event naming a recording this host does not hold is rejected but marked retryable, because a guest that played offline can arrive before the recording's document has finished syncing here.

Duplicates are dropped per device rather than by bare event id, matching how the store keys its index, so two guests that mint ids the same way cannot swallow each other's plays. Ingest is rate-limited per connection and bounded in both batch size and body bytes, so a loop cannot fill the host's disk; an oversized batch is refused whole rather than truncated, leaving the client's queue intact. Beyond the shared pairing token these events are unauthenticated, so anyone the host handed a QR code to can inflate a count — an accepted trade for a LAN tool among invited people, written down so the numbers are not later mistaken for audited ones.
