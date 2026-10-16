---
'@tapes-monorepo/core': minor
'electron-client': minor
'web-client': minor
---

The Recorder now has a session strip at the top. On the desktop host it starts and stops a session. While a session is open it shows the short session ID and how long the session has been open. After a stop it counts down to signing and then shows whether the record was signed.

A paired web guest sees the same strip, read-only. It shows the open session from the shared doc, or says it cannot reach the host. During a take it describes the session the take started in. A web client with no host shows no strip.

Stopping a session now answers with the time its record will be signed. A new `session:settled` event tells the renderer when signing finished or failed. Shells can pass a host connection to `Providers`, and `createHostConnection` builds one from a sync adapter.
