---
'@tapes-monorepo/core': minor
---

The operator can now give their own name to a person key, a device key or a host key, and that name leads wherever the key is shown.

Every name Tapes received over the wire was self-reported. A device sends its own label, a host puts its own name in the pairing link, and a person picks the name a host's roster shows. Nothing checks any of them, so recognition rested on either a name anyone could copy or a key fingerprint nobody can read. Names are now kept per device in `localNames.ts`, keyed by public key, and never in the Automerge document where other peers could edit them.

Naming is offered on a Library row's details, on the roster, on a pending vouch, on a connected device and on a trusted host. A pending vouch is the moment the operator is looking at both the device and the person holding it, so that is where they are asked. Nothing is suggested or pre-filled: a suggested name reads as proof of identity when it is only an echo. Where a local name exists, the self-reported one moves beside it as a claim. A name already used by another key of the same kind warns and saves anyway.

A connected device that nobody has named now shows its key fingerprint rather than "Unknown device". The host sends the device key with each connection, each pending vouch and each signed vouch, so those rows have a key to hang a name on. No statement type changed and no signature covers a local name.
