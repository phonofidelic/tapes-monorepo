---
'@tapes-monorepo/core': patch
---

Changing a sync setting now rebuilds the Automerge repo in place instead of reloading the window.

Switching sync server mode, saving a remote sync server URL or pairing token, and toggling HTTPS each called `window.location.reload()`, because the settings that decide where the repo syncs live inside `App` while the repo is built by the shell above it. Core now publishes every settings write through `subscribeToSettingsChange`, and the electron shell re-resolves its sync servers and blob endpoints on the ones that matter, swapping in the new repo once it has loaded the library and closing the superseded sockets after. A resolution that lands on the same servers is a no-op, and a switch to a server that does not hold the library leaves the working repo in place rather than replacing the app with an error.
