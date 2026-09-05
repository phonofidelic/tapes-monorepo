---
'@tapes-monorepo/core': minor
'electron-client': minor
'web-client': minor
---

Serve playback aggregates to clients over HTTP and IPC (TAP-100).

The host now answers `GET /events/aggregates` with every recording's plays and
average completion in one response, guarded by the same pairing token as the
rest of `/events`. A device reading its own embedded host takes an
`events:get-aggregates` IPC channel instead, so it does not go through its own
network stack to reach a map in the same process tree.

Which host to ask is one decision, `resolveEventTarget`, shared by the read
path and by the flush that will follow it: the remote edge when the device has
one, else the local host. A desktop app paired with someone else's server would
otherwise read its own store and report zeros for a library whose plays all
went elsewhere.

Clients hold the numbers for a minute and revalidate with an entity tag on
reconnect. Nothing waits on them — a row renders without its counts and gains
them when the host answers.
