---
'electron-client': patch
---

Fixes a web guest always reporting "Still uploading from the host" for a recording made on the electron host. The preload's IPC allowlist was hand-maintained alongside core's `ValidIpcChanel` union and had drifted from it: all three blob channels were missing, so `blob:put-file` was dropped without a word and the promise `IpcService.send` returned never settled. The upload never completed, no blob descriptor was ever written to the recording's document, and every guest was told the audio was still on its way. `blob:has` and `blob:cache-put` were dropped the same way, leaving the desktop app's blob cache silently inert. The allowlist is now keyed by the union itself, so a channel added to core and forgotten here fails `check-types`, and an unlisted channel throws instead of hanging its caller.
