---
'@tapes-monorepo/core': minor
'electron-client': minor
'web-client': minor
---

A recording's signed claim now names the host session that was open when the take started. A take that runs past the end of its session keeps that session's ID. With no open session, the claim keeps the placeholder ID as before.

The desktop host reads the open session from its own state when sox starts. A browser guest reads it from the root document, but only while its sync socket to the host is up. A guest that has lost the host signs the placeholder, because its copy of the document may still show a session that has closed.

The web-client app context gains an optional `isHostConnected` check, and the recorder's `startRecording` takes the session the root document shows.
