---
'@tapes-monorepo/provenance': minor
'@tapes-monorepo/core': minor
'electron-client': minor
'web-client': minor
---

Each recording is now hashed and signed by the device that captured it, when recording stops. The signed claim covers the bytes the recorder wrote, before they reach the host.

A browser guest hashes its OPFS file in the recording worker and signs with its device key. The claim is sent with the upload in the `X-Tapes-Recording-Claim` header, and a queued upload keeps its claim for the retry. The desktop host hashes the file sox wrote and signs with the host key, then passes the claim along when it ingests the file.

Signing is best effort. A device with no signing key, such as a guest on plain HTTP, records and uploads as before, without a claim. The host does not check claims yet.

The provenance package adds `createRecordingClaim`, a placeholder session ID, and an encoding that carries a signed statement as one base64url string.
