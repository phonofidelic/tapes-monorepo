---
'@tapes-monorepo/core': minor
'electron-client': minor
'web-client': minor
---

Serve playback aggregates to clients over HTTP and IPC.

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
