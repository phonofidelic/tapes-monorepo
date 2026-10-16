---
'@tapes-monorepo/provenance': minor
'@tapes-monorepo/core': minor
'electron-client': minor
---

A recording's provenance now includes its signed session record. The verifier checks the record's signature against the host key it names. The record must be for the verified claim's session and must list that claim. A record that fails these checks makes the provenance Failed, the same as a bad claim or receipt. A passing record adds a `session` field with the open and close times, the host key, and each device's key and spans. Device labels are left out, because a device names itself.

The Library's provenance details now show the session from its signed record. They give the open and close times by the host's clock. They list each connected device as "this device" or by key fingerprint, with its join and leave times. They also say that the host key is not checked yet.

The desktop host now adds a signed session record to the statements list of each recording whose claim it lists.

The recorder now adds the hashes from an upload to the statements list instead of replacing it. A retried upload no longer drops a session record the host added.
