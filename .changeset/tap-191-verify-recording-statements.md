---
'@tapes-monorepo/provenance': minor
'electron-client': patch
---

The provenance package can now decide what a recording's statements prove. `verifyRecordingStatements` takes the recording's blob descriptor and the statements core fetched for it. It returns one of five states: verified, signed on device only, unverified, failed, or unavailable. It returns only fields taken from statements that passed.

The package also adds `checkHostReceipt`, `parseSignedStatement`, `statementType` and `keyFingerprint`. The first three moved from the desktop host's upload checks, which now call the package instead.
