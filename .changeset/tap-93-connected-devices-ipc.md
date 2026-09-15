---
'@tapes-monorepo/core': minor
'electron-client': minor
---

Shows the renderer who is connected to this host, and keeps the list current.

The host has tracked its live sync connections for a while, but nothing outside the main process could read them. A new request channel answers the snapshot a panel needs when it mounts.

That request alone would leave the panel polling. A polled list keeps showing a device that has already left until the next request. So the host also sends an event on every connect, disconnect and keepalive eviction. This is the first main-to-renderer event in the app. Each one carries the whole list rather than a delta, so a renderer that misses one recovers on the next.

The event seam is one event wide. Everything else here is request/response, and a general event bus for a single consumer would add work without adding value. Events get their own preload allowlist, keyed by the event union so a new one cannot be forgotten. Listeners return an unsubscribe. Without one, every remount of a panel would add another listener for the life of the window.

An empty list and a missing answer stay separate throughout. A device that runs no sync server reports a failure instead of an empty list. Both show as a blank panel, but one means nobody has joined and the other means this device is not hosting.
