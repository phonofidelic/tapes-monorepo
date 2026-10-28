---
'@tapes-monorepo/provenance': minor
'@tapes-monorepo/sync-protocol': minor
'@tapes-monorepo/core': minor
'electron-client': minor
'web-client': minor
---

A host can now vouch for a guest's new device after the guest lost its keys. The provenance package adds a host-signed vouch, a vouch request signed by the new device key, and a join request signed by the person key. A claim's device certificate address can name a certificate or a vouch, and the verifier reports which it found. The Library shows a vouched device as "Sam, vouched by Studio Mac".

The host keeps a roster of people in `people.json`. A guest joins it on first join, with a name and an optional 4 to 6 digit PIN, as the first step of the person key prompt. The host vouches for a new device once the operator confirms or the right PIN is typed. Wrong PINs are counted per person, and five close the PIN path until a restart.

A guest with no keys on a host that already knows people can pick their name, type their PIN or wait for the operator, and receive a vouch. The pairing link carries the host's public key as `hk`, and the guest keeps a vouch only if that key signed it. The host's window lists waiting devices for the operator to confirm or reject.

A person can restore their person key from its backup by camera scan, file, photo of the QR code or pasted text. The person key then certifies the device and replaces the host's vouch. Core adds `jsqr` to read QR codes, since iOS Safari has no BarcodeDetector.

Guests get a "Your name" setting. The host's device name setting now names the host itself and defaults to the Mac's computer name. The sync protocol package renames its device label sanitizer to `sanitizeLabel`, because it now covers person and host names too.
