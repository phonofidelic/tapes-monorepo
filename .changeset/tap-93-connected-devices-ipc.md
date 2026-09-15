---
'@tapes-monorepo/core': minor
'electron-client': minor
---

Puts the host's list of connected devices in front of the renderer, and keeps it current.

The host has known who is connected since the connection registry landed, but nothing outside the main process could read it. There is now a `sync:get-connected-devices` request for the snapshot a panel needs when it mounts.

That request alone would leave the UI polling, and a polled presence list is stale between ticks by definition: a phone carried out of range is still shown as here until the next one. So this also adds the first main-to-renderer event in the app. Connects, disconnects and keepalive evictions are pushed as they happen, each carrying the whole new list rather than a delta, so a renderer that misses one is corrected by the next.

The event seam is deliberately one event wide. Every other IPC path here is request/response, and generalising this into an event bus for a single consumer would buy nothing. It has its own preload allowlist, keyed by the event union so a new event cannot be forgotten, and its listeners come with an unsubscribe — without one, every remount of the panel would add another listener for the life of the window.

An empty list and no answer are kept apart throughout. A host that is not running a sync server reports a failure rather than an empty list, because a panel handed `[]` would tell the user nobody has joined when the truth is that this device is not hosting at all. The two look identical on screen and mean opposite things.
