---
'@tapes-monorepo/core': minor
'electron-client': minor
---

A host's operator can now trust another host's vouches. The host keeps the keys it trusts in `trusted-hosts.json`, beside its roster of people. Only the operator's own window can change the list, over IPC.

The Library names a vouched person without the host once this reader counts the vouch. It counts it when the operator trusts the signing host's key, or when the person's own key has since certified the device that recorded. A certificate is the person's signature, so it settles the question whoever vouched. Every other host's vouch keeps the name it had, such as "Sam, vouched by Studio Mac".

The operator trusts a host from the vouch in front of them, with a button on the Library row. That is where both the key and the host's name for itself are. Settings lists each trusted key by fingerprint with that name, removes one, and takes a key typed in from another host's pairing link, which carries no name.
