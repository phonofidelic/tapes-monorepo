---
'@tapes-monorepo/provenance': minor
'@tapes-monorepo/sync-protocol': minor
'@tapes-monorepo/core': minor
'electron-client': minor
'web-client': minor
---

A host can now vouch for a guest's new device after the guest lost its keys. The provenance package adds a host-signed vouch, a vouch request signed by the new device key, and a join request signed by the person key. A claim's device certificate address can name a certificate or a vouch, and the verifier reports which it found. The Library shows a vouched device as "Sam, vouched by Studio Mac".

The host keeps a roster of people in `people.json`. A guest joins it on first join, with a name and an optional 4 to 6 digit PIN, as the first step of the person key prompt. The host vouches for a new device once the operator confirms or the right PIN is typed. Wrong PINs are counted per person, and five close the PIN path until a restart.

Guests get a "Your name" setting. The host's device name setting now names the host itself and defaults to the Mac's computer name. The sync protocol package renames its device label sanitizer to `sanitizeLabel`, because it now covers person and host names too.
