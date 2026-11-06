---
'@tapes-monorepo/core': minor
---

Renames the exported `BlobDescriptor` type to `RecordingBlobDescriptor`. The type describes where a single recording's audio lives, so the old name was broader than what it covers.

This is a breaking rename of a published type. Importers of `BlobDescriptor` from `@tapes-monorepo/core` must update the name. The shape is unchanged.
