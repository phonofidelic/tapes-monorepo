---
'@tapes-monorepo/provenance': minor
---

Adds `@tapes-monorepo/provenance`, a plain TypeScript package for signed statements about recordings. Guests and the host will both import it.

It defines the first two statements. A recording claim is signed by the device that recorded. A host receipt is signed by the host after it checks the claim. Each statement names its format and version in a `type` field, such as `tapes/recording@1`.

Statements are serialized as canonical JSON (RFC 8785), so every device produces the same bytes. They are signed with Ed25519 over WebCrypto. A signed statement's address is the sha-256 of its canonical JSON, in the same hex form the blob store uses.

Nothing calls the package yet.
