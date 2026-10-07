---
'@tapes-monorepo/core': patch
'electron-client': patch
---

A recording's list of signed statement hashes is now called `statements` instead of `attestations`. This matches the provenance package, which calls claims and receipts statements. The host's upload answer uses the new name too. Recordings made before this change lose their links to their claim and receipt.
