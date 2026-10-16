---
'electron-client': minor
'@tapes-monorepo/core': patch
---

A host now accepts a session record that a client copies to it. Before, the upload check took only claims and receipts, so a recording copied to a second host lost its session record there.

The host stores a session record only if its signature verifies and it lists at least one claim the host already holds. When copying statements, the client now sends every claim first, so a session record never arrives before its claim.
