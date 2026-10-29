---
'@tapes-monorepo/core': minor
---

A guest can now run a passkey ceremony at a separate origin and get the result back. WebAuthn refuses the host's LAN IP as a relying party id, so the passkey runs on a small static page instead. `runPasskeyCeremony` opens that page in a new tab, sends it the request, and resolves with the credential id and the passkey's PRF output.

The handoff is checked rather than trusted. The page is addressed by an exact origin, the reply has to come from the tab that was opened and from that same origin, and a result carrying another ceremony's nonce is ignored. A closed tab, a blocked pop-up and a password manager that returns no PRF output each come back as their own problem, so a caller can say which one happened.

The pairing link gains a fifth parameter, `hn`, carrying the host's own name for itself. A guest keeps it and uses it to say which host a ceremony is for. It is self-reported and unverified, like the name a device sends on the socket, and it goes through the same sanitizer and length cap.

This is the handoff on its own. Wrapping a person key with what the ceremony returns, keeping that record and restoring from it come with passkey recovery, in the same release.
