---
'@tapes-monorepo/provenance': minor
'@tapes-monorepo/sync-protocol': minor
'@tapes-monorepo/core': minor
---

A passkey can now bring a person key back on a new phone. The person key is wrapped for a passkey, the locked copy is kept on the host, and the same passkey opens it again on a device that holds nothing. The passphrase backup is unchanged and is still the way through when a passkey cannot help.

The record format gains unlock method 2, from Person key wrapping format v1. The passkey's PRF output never acts as a key: HKDF-SHA-256 derives the AES-256-GCM wrapping key from it with the record's own salt, and separately a token a client shows to fetch its record. The header carries the relying party hash and the credential id, and the header is the cipher's additional data, so a record only opens for the passkey that made it at the domain it was made under. Method 1 is byte for byte unchanged, and test vectors for both methods sit next to the implementation.

`decodeBackup` now branches on the method byte before any length check, so a record it cannot open says so instead of looking damaged. The byte it used to call a KDF id is the unlock method, and the problem it reports is now `unsupported-method`.

The host keeps the records, which answers where they live. It is already what a guest reaches, it owns the roster, and it needs no new service or account. Total loss with the host unreachable stays uncovered, which is what the passphrase backup is for.

A write must be signed by the person key the record names, over a challenge from the host, and that person must be on the roster. Holding the pairing token is not enough: an overwrite would take away someone's way back from a lost phone. Reading needs the token derived from the passkey, so a paired peer cannot collect other people's records, and a wrong token and an unknown credential id give the same answer. One person keeps at most five records, and repeated fetches for one credential id are throttled.

Settings offers "Protect with a passkey" on a device that holds the person key, and the restore flow offers "Use your passkey" where the host is reachable. The `?passkey=1` handoff check is gone, replaced by the real flow.
