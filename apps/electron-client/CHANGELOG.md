# electron-client

## 1.1.0

### Minor Changes

- a2990fd: Serve playback aggregates to clients over HTTP and IPC.

  The host now answers a request for every recording's plays and average
  completion in one response. It uses the same origin and pairing token as the
  existing event ingest. A device reading its own embedded host uses a new IPC
  channel instead of the network.

  One resolver decides which host to ask: the paired remote server when the
  device has one, and the local host otherwise. Without it, a desktop app in
  remote sync mode reads its own store and reports zeros for a library whose
  plays went to the paired server.

  Clients hold the numbers for a minute and revalidate with an entity tag on
  reconnect. Nothing waits on them. A row renders without counts and gains them
  when the host answers.

  Also fixes a gap from the previous release. Accepted events did not update the
  stored totals, so a play only appeared after the host restarted.

- b86f7fb: Reclaims blob-store space the refcount can never free. The host now walks its library graph on startup and unlinks objects nothing references — bytes left by a crash between the object write and its ref record, and audio whose recording was deleted by a peer that never reached the host to release it.

  Objects younger than 24 hours are always kept, since a recording is uploaded independently of its document arriving. The sweep marks against _every_ library the host has served, not just this device's own, so a guest that brought its own library keeps its audio. A document that will not load abandons the sweep rather than letting an incomplete picture delete live recordings.

  Logging reports the hardlink count, because dropping the store's link to an object the user still has in their recordings folder frees no space at all.

- ced9dbb: Opens the host's `POST /events` route, where a guest's queued plays land. It sits on the same origin, port and pairing token as `/blobs` — a guest already reaches this host and already holds the token, so there is no new port to open, no second CORS story, and nothing further to configure — and, like the blob routes, is mounted ahead of the static handler so a flush can never be answered by the SPA fallback's 200.

  A flush is a batch, so the answer is per event: accepted ids, ids this device had already sent, and rejections carrying the position in the batch, a reason, and whether it is worth retrying. Without that a client could neither safely clear its queue nor safely resend it. Completion is clamped into `[0, 1]` rather than rejected — a 1.02 is a rounding artefact of a play that finished, not a reason to lose the play — and an event naming a recording this host does not hold is rejected but marked retryable, because a guest that played offline can arrive before the recording's document has finished syncing here.

  Duplicates are dropped per device rather than by bare event id, matching how the store keys its index, so two guests that mint ids the same way cannot swallow each other's plays. Ingest is rate-limited per connection and bounded in both batch size and body bytes, so a loop cannot fill the host's disk; an oversized batch is refused whole rather than truncated, leaving the client's queue intact. Beyond the shared pairing token these events are unauthenticated, so anyone the host handed a QR code to can inflate a count — an accepted trade for a LAN tool among invited people, written down so the numbers are not later mistaken for audited ones.

- 485c28a: Gives the host a durable place to keep playback events. Accepted events are appended to a log on the host's own filesystem, next to the blob store, and survive a restart — which is what lets aggregates be recomputed from scratch rather than kept as merged counters no concurrent writer could ever repair.

  The log is never rewritten, only appended to and swept a whole day at a time, so an unclean quit can leave at most a torn final line, which every reader skips. Seen events are indexed in memory when the store opens, so a retried flush after a lost response is recognised as a duplicate without reading the log. That index is keyed per device rather than by a bare event id: ids are minted client-side, and two guests arriving at the same naive scheme would otherwise have one device's plays silently swallowed as duplicates of the other's.

  Events are kept for 90 days. That sweep rides the same startup moment as the blob store's `tmp` sweep instead of getting a scheduler of its own, and keys on the host's clock rather than the guest's, so a device with a badly wrong clock cannot hold its events past every sweep or lose them before they are counted.

- d8dd084: Turns the host's playback-event log into the two numbers the feature promises: plays and average completion, per recording.

  Average completion is the mean of the per-play completion values, not total-listened over `plays × duration`. The two diverge as soon as anyone replays a tape, and only the per-play mean answers "did people sit through it". Each recording therefore carries a sum and a count rather than a pre-divided average, since two averages cannot be combined without their weights.

  Nothing here is a merged counter. Every number is a fold over the log, so a rollup that is lost, stale or corrupt is a rebuild rather than a permanently wrong count — the rollup exists only so a read does not pay for a replay. It is derived once when the host starts, updated incrementally as events are accepted, and can be rebuilt on demand.

  Retention would otherwise eat into these numbers: a host looking at an old tape wants its lifetime play count, and a number that silently decreases as events age out is worse than no number. So an expiring day of events is folded into a frozen baseline and that baseline is persisted _before_ the events are unlinked, with every rollup starting from it. A crash anywhere in that sequence loses nothing — the events stay on disk until the last step, and a segment that is briefly in both places is counted once. If the baseline cannot be written, the expired events are kept and swept on a later pass, since deleting them after failing to freeze them would lose those plays from both places at once.

### Patch Changes

- bf39189: Fixes a web guest always reporting "Still uploading from the host" for a recording made on the electron host. The preload's IPC allowlist was hand-maintained alongside core's `ValidIpcChanel` union and had drifted from it: all three blob channels were missing, so `blob:put-file` was dropped without a word and the promise `IpcService.send` returned never settled. The upload never completed, no blob descriptor was ever written to the recording's document, and every guest was told the audio was still on its way. `blob:has` and `blob:cache-put` were dropped the same way, leaving the desktop app's blob cache silently inert. The allowlist is now keyed by the union itself, so a channel added to core and forgotten here fails `check-types`, and an unlisted channel throws instead of hanging its caller.
- Updated dependencies [aa4878d]
- Updated dependencies [86014e3]
- Updated dependencies [a2990fd]
- Updated dependencies [7db8832]
- Updated dependencies [15636fa]
- Updated dependencies [e177c6e]
- Updated dependencies [82eeb3e]
- Updated dependencies [24b75fa]
- Updated dependencies [2229fc7]
- Updated dependencies [0fcda8e]
- Updated dependencies [47b849f]
- Updated dependencies [b86f7fb]
- Updated dependencies [bf3ea38]
- Updated dependencies [6e4ea15]
- Updated dependencies [a44270b]
- Updated dependencies [5e39526]
- Updated dependencies [899b239]
- Updated dependencies [3e79760]
- Updated dependencies [c259b9a]
  - @tapes-monorepo/core@0.1.0
