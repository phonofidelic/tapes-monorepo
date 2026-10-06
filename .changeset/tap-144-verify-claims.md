---
'@tapes-monorepo/provenance': minor
'@tapes-monorepo/core': minor
'electron-client': minor
---

The desktop host now checks each recording's signed claim when it stores the audio, and countersigns valid claims with a receipt. It checks that the claimed hash and size match the bytes it received and that the signature verifies against the device key. The receipt records the time by the host's clock, which a guest device cannot set.

A claim that fails a check does not fail the upload. The host keeps the audio, issues no receipt, and reports the claim as unverified with the reason. Uploads and ingests now answer with the claim's status and, when verified, the encoded receipt. Storing receipts comes next.

The provenance package adds `checkRecordingClaim` and `createHostReceipt`.
