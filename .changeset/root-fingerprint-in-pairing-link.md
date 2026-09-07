---
'@tapes-monorepo/electron-client': patch
'@tapes-monorepo/core': patch
---

Shows the host root certificate's SHA-256 fingerprint in Sync settings and carries it in the pairing link the QR code encodes.

A browser cannot pin a certificate, so nothing checks the root a guest installs. The fingerprint can still be read. Because the QR is scanned in the same room as the host, the value in it is one the person can trust, and comparing it against the root they are about to install is what rules out someone else on the LAN answering as the host.

`SyncServerInfo` gains `rootCertFingerprint`, set when the sync server runs over HTTPS. Settings shows it as uppercase colon-separated pairs. The link gains an `fp` parameter alongside `am` and `pt`, base64url rather than hex to keep the QR sparse enough to scan across a room. As with the token, no link is built at all when there is no LAN URL. The fingerprint is not a secret: unlike the pairing token it grants nothing.
