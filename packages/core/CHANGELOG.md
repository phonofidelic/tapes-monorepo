# @tapes-monorepo/core

## 0.1.0

### Minor Changes

- 86014e3: The pairing link a host hands a guest is now only ever its own LAN URL. It previously fell back to the deployed web-client whenever the host had no `lanWebAppUrl` — while still appending `pt=<pairing token>`, publishing a credential for the host's sync socket and `/blobs` on an origin that cannot reach it. That was reachable in ordinary use: between enabling LAN sharing and the refreshed server info arriving, and whenever `ipconfig getifaddr en0` is empty. `guestUrl` now requires `lanWebAppUrl`. Development is unaffected — the host already advertises the dev server as `lanWebAppUrl` (see `webClientDevUrl`).

  Two more defects in the same link: the token was read from a stale closure, so a fresh host's first link carried no `pt` and no guest could join it; and that same write overwrote the `pairingToken` setting, which holds the token for a _remote_ host, discarding a saved pairing on every trip through embedded mode.

  Sync settings are consolidated into `SyncSettings` — server mode, the LAN and HTTPS toggles, the QR, and the import field — leaving audio and storage in `Settings`.

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

- 7db8832: Show plays and average completion on each recording in the Library.

  Each row now carries a quiet line next to its duration: the number of plays, and
  how far through the recording those plays got on average. The counts come from
  the aggregates the host serves, so no extra request is made per row.

  Three states are shown differently on purpose. A host that answers with no plays
  for a recording reads as "0 plays". A host that has not answered reads as "Plays
  unknown", never as a zero. A single play is reported without the word average,
  because one measurement is not one.

- 15636fa: Settings no longer disappear from state while they are still in storage. `readSettingsFromLocalStorage` had an early return taken whenever `audioChannelCount` or `audioFormat` was missing, and that path returned _only_ those two keys — dropping everything else the user had saved. With the sync settings now living in the same blob, the cost had grown from a forgotten storage location to a guest device whose `pairingToken` and `syncServerMode` read as unset in the app while storage still held them, so a paired device looked unpaired. Defaults are now merged over the stored object rather than replacing it.

  React state is the source of truth: a write persists the whole settings object instead of read-modify-writing storage per key, and it composes off a ref, so two settings changed in the same tick no longer see the second overwrite the first. The stored shape is unchanged — one flat object under `settings`, unset keys absent — which is what the shells parse directly to resolve their sync server.

  Reading and writing are wrapped: corrupt JSON in `settings`, or no storage at all, now loads the app on defaults with a warning instead of throwing inside a `useState` initializer and taking the whole app down.

  `useSetting` is generic over its key, so its setter takes only values that key allows — `setAudioFormat('xyz')` is now a type error — and `undefined` is the single representation of unset, replacing the `null` that state held but storage never did. `automergeUrl` is dropped from `Settings`; it was never managed here, and `utils.ts` persists it under its own key.

- 82eeb3e: The app layout now holds its content to a centred `max-w-3xl` column instead of running edge to edge. The web client used to hide `App` entirely above the `sm` breakpoint, so this layout had only ever been seen at phone widths and inside the Electron window; with that gate gone it needed to survive a 1440px browser. `main` carries the constraint itself rather than an inner wrapper, because the Recorder view positions its visualizer and transport `absolute` against it — a wrapper would have left those full-bleed. The nav bar and audio player stay full-bleed so their backgrounds and borders still span the window, and only their contents follow the column. Below `3xl` nothing binds, so the mobile layout is byte-identical. The Recorder's recording-name bar changes from `fixed w-screen` to `absolute w-full` for the same reason; `main` is itself fixed to the bottom of the viewport, so it resolves to the same place.
- 24b75fa: `App` no longer builds the Automerge `Repo`. Each shell now constructs its own and passes it in as `repoContextValue` (`null` while bootstrapping), because storage and network adapters are platform-specific: the web client persists to IndexedDB, while the electron renderer runs without a storage adapter and lets its embedded sync server persist to the filesystem. The `syncServerUrl` prop is gone — nothing in core used it once the repo moved out.
- 2229fc7: Adds the client half of out-of-band audio storage, ahead of recordings actually using it. `blobClient` (`uploadBlob`/`fetchBlob`/`headBlob`/`deleteBlob`/`resolveBlobEndpoint`) talks to the sync host's new `/blobs` surface, and `callWorker` gives the web-client's storage worker a request/response helper with correlated ids so overlapping requests can no longer take each other's replies. `BlobDescriptor` is exported from `types`, and `SyncServerInfo` gains `blobBaseUrl`, `lanBlobBaseUrl` and `blobToken`. Nothing reads or writes these yet: `RecordingData` is unchanged and recordings still embed their audio.
- 0fcda8e: Recordings now sync as metadata only. `RecordingData` carries a `blob` descriptor (content hash, size, MIME type, extension) instead of the raw bytes, and the audio itself lives in the sync host's content-addressed store, fetched on demand. `audio` and `mimeType` remain on the type but are read-only and deprecated: Automerge history is append-only, so documents written before this change keep their embedded bytes forever and must go on playing.

  Playback resolves in order: legacy embedded bytes, then the device-local cache, then this device's own copy of a recording it made, then a fetch from the host (cached on arrival). `useAudioPlayer` gains `playbackState` so a first-play download shows progress and a failure surfaces instead of silently clearing the player. New `PinProvider`/`usePins` add per-device "keep offline" pins, stored outside the synced document. `App` takes a `blobEndpoint` prop, which each shell resolves; leaving it undefined keeps a standalone client working entirely on-device.

  The 50 MB embed cap is gone — recordings above it previously failed to sync with only a console warning.

- 47b849f: The embedded sync socket now requires the pairing token. The token minted in `sync-server.json` is no longer only a `/blobs` credential, so it is renamed `pairingToken` throughout (`SyncServerInfo.blobToken` -> `pairingToken`), and the host verifies it on the websocket upgrade with the same timing-safe comparison the blob routes use — accepting it as `Authorization: Bearer` or, since a browser cannot set headers on a `WebSocket`, as `?t=`.

  Previously anyone who could reach the host's port could join the repo and read or rewrite the whole library. Both clients now present the token: the web client on the same-origin `/sync` URL (never on a remote or build-time server, which is a different deployment with a different secret), and the Electron renderer on the embedded server's URL. The QR/copy pairing link carries the token as `pt` instead of `bt`.

  There is no compatibility window — the check is unconditional. Any device paired against an older dev build simply re-pairs from the QR code.

- b86f7fb: Reclaims blob-store space the refcount can never free. The host now walks its library graph on startup and unlinks objects nothing references — bytes left by a crash between the object write and its ref record, and audio whose recording was deleted by a peer that never reached the host to release it.

  Objects younger than 24 hours are always kept, since a recording is uploaded independently of its document arriving. The sweep marks against _every_ library the host has served, not just this device's own, so a guest that brought its own library keeps its audio. A document that will not load abandons the sweep rather than letting an incomplete picture delete live recordings.

  Logging reports the hardlink count, because dropping the store's link to an object the user still has in their recordings folder frees no space at all.

- bf3ea38: Recorded audio now resolves against every host this device is paired with rather than a single one. `resolveBlobEndpoint` becomes `resolveBlobEndpoints` and returns an ordered list — the embedded host first, then the page origin, then a configured remote — and `App` takes `blobEndpoints` in place of `blobEndpoint`. Playback and pinning fetch through `fetchBlobFromAny`, which treats a 404 as "ask the next host", and then quietly copy the bytes to the hosts that were missing them (`replicateBlob`), so a recording does not stay playable only while one particular machine is awake. Deleting releases the claim on every non-local host.

  This is what the desktop app needed to work in `syncServerMode: 'remote'`: it syncs docs whose hashes its own store has never seen, and used to 404 against itself with nowhere else to look. It can now store a `pairingToken` for that remote host — there is a field for it in Sync settings — which opens both the remote socket and its `/blobs` surface. The "keep offline" pin control, previously hidden on electron outright, is now gated on whether any host other than this device's own disk is in play, so a remote-mode desktop gets it and an ordinary host still does not.

- a44270b: Importing a host URL in Settings now takes effect immediately instead of on the next launch. `setAutomergeUrl` only wrote `localStorage`, and every reader — `Library`, `Recorder`, and the shells that build the repo around this url — re-read that value during render with nothing to tell them to render again. Pasting a pairing link and clicking Import therefore changed nothing on screen: no library, no error, no confirmation, even though the import had in fact worked.

  `useAutomergeUrl` is now backed by `useSyncExternalStore` over a module-level listener set, the same seam `subscribeToSettingsChange` already uses for the sync settings the shells read from above the React tree. A write re-renders the readers, so the desktop shell rebuilds its repo against the imported document (its effect was already keyed on this url) and the web client finds the document through the repo it already has — its adapters are unchanged, so nothing there needs rebuilding.

  `setAutomergeUrl` also drops the `am` query parameter it supersedes. That parameter is a bootstrap seed a pairing link leaves in the address bar, and it takes precedence over storage — so on a guest opened from a QR code, importing a different document would have gone on being invisible.

  Two smaller fixes in the same flow: the import button now confirms what happened rather than succeeding silently, and a pasted pairing link's `pt` token is kept instead of discarded. Without that token the imported document resolves to an id this device can open neither the host's sync socket nor its `/blobs` for.

- 5e39526: The player's transport bar is now a seek control instead of a read-only progress line. Reviewing a moment in a long tape meant listening to it from the top: the bar was a 1px `div` whose width was `currentTime / duration`, with no pointer handlers, no keyboard affordance and no hit area, and the only controls were play/pause and stop.

  Clicking anywhere on the track seeks, and dragging scrubs — the bar and the elapsed readout follow the pointer while the audio moves on press and on release, with pointer capture so a drag that leaves a 12px strip keeps tracking. The visual track stays a hairline; the interactive strip around it is 12px tall, and the wrapper's full-bleed/`max-w-3xl` arrangement is unchanged. The bar carries `role="slider"` with `aria-valuemin`/`max`/`now`/`valuetext`, takes focus, nudges 5s on the arrow keys and jumps to the ends on Home/End.

  Seeking goes through the context rather than the element directly. `clickedTime`/`setClickedTime` — declared, exposed, and never read or written by anything — are gone, replaced by a `seek(time)` that clamps and moves both the element and the transport, and by a `seekableDuration` the bar takes its fraction from. That second value is what makes the control safe on a web-client recording: `duration` is commonly `Infinity` for a MediaRecorder-written `audio/mp4` until the element has seen the whole stream, so `seekableDuration` falls back to `audio.seekable`'s end and to `0` when nothing is addressable. At `0` — and while playback is `loading` or in `error` — the bar renders grey, drops out of the tab order, reports `aria-disabled`, and ignores pointer and key input.

  `onEnded` no longer reports `currentTime` as 0 while parking the element at the end. The two disagreed, which was invisible while the bar was read-only and would have made a seek after a natural end start from somewhere the UI never showed. The `key={currentTime}` that remounted the progress div on every `timeupdate` is also gone; it would have fought the drag state.

- 899b239: Measures play sessions in `AudioPlayerContext`, the first half of counting how far a shared recording actually got listened to. A session opens when playback starts on a recording and closes on pause, a natural end, a change of recording, or the provider unmounting — the last of which is how most plays end. It reports through a new optional `onPlaySession` prop, and only once it accumulated five seconds of real playback, so a scrub or a mis-tap is not a play. The reported `completion` is the high-water mark of `currentTime` over the session, clamped to `[0, 1]`: re-listening to a passage cannot push a play past 100%, and a seek is never counted as listening. A session whose recording has no addressable length — the `Infinity` duration a MediaRecorder-written mp4 reports until it has been played through — is dropped rather than reported as an invented percentage. Nothing consumes these yet; the queue that carries them to the host comes next.
- 3e79760: Queues finished play sessions on the device and flushes them to the host that owns the recording's library. A play now survives being offline and survives a reload.

  The queue lives in device storage, not in the Automerge doc, so one phone's pending sends are not synced to every peer. It is kept per host and capped at the host's batch size, so a full queue always fits in one request.

  The queue clears itself against the host's per-event answer. Accepted, duplicate and non-retryable events are dropped. Everything else stays, including an event whose recording has not finished syncing to the host. Retries to an unreachable host back off from five seconds to five minutes. Flushes also run on reconnect, on returning to the foreground, on pairing, and when a play finishes.

- c259b9a: Stop filtering out virtual devices from the input device selector

### Patch Changes

- aa4878d: Fixes playback on a web guest for a recording made on the electron host. The player's local-copy step handed the recording's `filepath` straight to OPFS, and a host recording's path is an absolute one from that machine's filesystem — `getFileHandle` rejects it with `TypeError: Name is not allowed` rather than reporting a miss, so the guest logged an error where it should simply have moved on to fetching the bytes from the host. The OPFS lookup is now skipped for anything that cannot be a flat OPFS name.
- e177c6e: Changing a sync setting now rebuilds the Automerge repo in place instead of reloading the window.

  Switching sync server mode, saving a remote sync server URL or pairing token, and toggling HTTPS each called `window.location.reload()`, because the settings that decide where the repo syncs live inside `App` while the repo is built by the shell above it. Core now publishes every settings write through `subscribeToSettingsChange`, and the electron shell re-resolves its sync servers and blob endpoints on the ones that matter, swapping in the new repo once it has loaded the library and closing the superseded sockets after. A resolution that lands on the same servers is a no-op, and a switch to a server that does not hold the library leaves the working repo in place rather than replacing the app with an error.

- 6e4ea15: Selecting a recording now detaches the audio element before resolving the new source, so a recording that cannot be resolved no longer plays the previously loaded one.

  Resolution is asynchronous and can end in `error` (a guest with the host offline and nothing cached), but the element kept the previous recording's `src` throughout. The player showed the new recording's name and "Not available offline" while happily playing the last tape. The player now also stops the transport when resolution fails, and the resolution path no longer bails out on a recording with no local `filepath` — a recording synced from another device is resolved from the cache or the host as it should be.
