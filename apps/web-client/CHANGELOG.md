# web-client

## 1.1.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [aa4878d]
- Updated dependencies [86014e3]
- Updated dependencies [a2990fd]
- Updated dependencies [7db8832]
- Updated dependencies [15636fa]
- Updated dependencies [e177c6e]
- Updated dependencies [82eeb3e]
- Updated dependencies [24b75fa]
- Updated dependencies [2229fc7]
- Updated dependencies [0fcda8e]
- Updated dependencies [47b849f]
- Updated dependencies [b86f7fb]
- Updated dependencies [bf3ea38]
- Updated dependencies [6e4ea15]
- Updated dependencies [a44270b]
- Updated dependencies [5e39526]
- Updated dependencies [899b239]
- Updated dependencies [3e79760]
- Updated dependencies [c259b9a]
  - @tapes-monorepo/core@0.1.0
