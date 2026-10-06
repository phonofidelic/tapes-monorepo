---
'@tapes-monorepo/provenance': minor
'@tapes-monorepo/core': minor
'electron-client': minor
---

The desktop host now stores a verified recording claim and its receipt in the blob store, next to the audio. Each is stored as its canonical JSON, so its blob hash is its statement address. Guests fetch them over `/blobs` like audio. Uploads and ingests answer with the hashes, and the recorder writes them into the recording's new `attestations` list.

Deleting a recording releases its attestations along with its audio. Blob GC counts attestation references the same way it counts audio. GC also keeps a statement while the recording that stored it is still in a library. A peer that removes a hash from the list therefore cannot get the statement deleted.

The provenance package adds `statementBytes` and `STATEMENT_MIME_TYPE`. `uploadBlob` and `ingestHostFile` in core now return the descriptor and the attestation hashes together.
