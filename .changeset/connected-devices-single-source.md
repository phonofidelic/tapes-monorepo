---
'@tapes-monorepo/core': minor
---

The host's connected-device panel now reads its list from `useConnectedDevices` instead of its own effect, and two defects go with the duplicate it replaces.

A failed first snapshot used to be permanent. The error was recorded once and never cleared, and it was rendered in preference to the list, so a host whose sync server was not yet running showed "Can't tell who is connected" until the window reloaded. The panel now recovers as soon as the host pushes a real list, and the message carries a "Try again" button. An unrecognised failure also no longer rethrows from inside the promise chain, where nothing could catch it.

`useConnectedDevices` gains the late-snapshot guard the panel already had. A successful snapshot no longer overwrites a pushed list that arrived while the request was in flight, which had dropped a device that joined in that window. The hook is no longer exported from the package: it is used inside `core` and nothing outside it consumed the export.
