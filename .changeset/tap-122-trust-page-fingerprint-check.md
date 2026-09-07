---
'@tapes-monorepo/electron-client': patch
'@tapes-monorepo/core': patch
---

Check the pairing link's fingerprint against the root the trust page is offering

The trust page used to print one fingerprint and ask the person to walk to the
host computer and compare it by eye. Everything on that page arrives over the
connection nothing has vouched for yet, so on its own it proves nothing: anything
answering as the host serves its own root and its own matching fingerprint, and
the page looks right.

The value in the pairing link is different. It was scanned in the same room, off
the host's own screen, and it is the one input on this page an attacker on the
LAN cannot reach. `/trust` now takes it as `fp` and makes the comparison itself.
A match says so and offers the install as before. A mismatch stops: no download
link, no install steps, both fingerprints side by side, and the one safe next
step, which is to go back to the host and scan again.

The QR is unchanged. It still points at the app, and Settings gives a guest that
arrived with an `fp` a link to `/trust?fp=…` carrying it across. With no `fp` the
page reads exactly as it did before, asking for the comparison by eye, which is
still correct. So does a value that is not a fingerprint: a verdict the page
cannot back up is worse than no verdict.

Fingerprints are compared as normalized lowercase hex, so the base64url the link
carries and the colon-separated pairs the page prints compare equal.
