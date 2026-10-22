---
'@tapes-monorepo/provenance': minor
'@tapes-monorepo/core': minor
'electron-client': minor
'web-client': minor
---

A web guest now makes a person key the first time it connects to a host. The person key signs a device certificate for the guest's device key. Each recording claim names that certificate, so a take traces back to a person and not only to a device.

Right after the key is made, the guest is asked to back it up. The default passphrase is six generated EFF words, and a chosen one is allowed. The backup is saved as a file or shown as a QR code. The person then types the passphrase again, and the prompt stops only once the saved backup unlocks.

The host stores the certificate next to the claim when it is the one the claim names. A copied certificate names its claim with `?for=`. The Library shows the person behind a recording, or "you" for this device's person key.

The provenance package adds `DeviceCertificate` and the version 1 person key backup format. The format is the TAP-218 prototype's, with Argon2id at 64 MiB and three passes. The KDF itself is in the web client, so the provenance package stays free of WebAssembly.
