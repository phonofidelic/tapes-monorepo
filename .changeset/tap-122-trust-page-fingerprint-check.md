---
'@tapes-monorepo/electron-client': patch
'@tapes-monorepo/core': patch
---

Check the pairing link's fingerprint against the certificate the trust page offers

The trust page printed one fingerprint and asked the person to compare it with
the host by eye. That value arrives over an unverified connection, so it proves
nothing on its own. Anything answering as the host can serve its own root and a
matching fingerprint.

The fingerprint in the pairing link was scanned off the host's screen. It is the
only input on the page that a machine on the LAN cannot forge. The page now
takes it as `fp` and makes the comparison.

A match says so and offers the install as before. A mismatch stops. It removes
the download link and the install steps, shows both fingerprints, and tells the
person to scan the code again at the host.

The pairing QR is unchanged. Settings gives a guest that arrived with a
fingerprint a link to the trust page carrying it. With no fingerprint, or one
that cannot be read, the page keeps its older wording.

Values are compared as lowercase hex, so the base64url in the link matches the
colon-separated pairs the page prints.
