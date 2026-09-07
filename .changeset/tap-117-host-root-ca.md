---
'electron-client': minor
---

Issue the LAN sync-server certificate from a root the host mints once.

The desktop host used to mint one self-signed certificate and replace it every
time the LAN IP changed, so guests saw a fresh browser warning each time. It now
mints a root certificate authority once per install and issues the server
certificate from that root. The root never rotates. A guest who installs it once
trusts every certificate the host issues afterwards. Both certificates live under
`sync-tls` in the user data directory, and the root's private key stays there.

The server certificate is now valid for 397 days rather than 3650. Apple rejects
longer server certificates that chain to a trusted root. It is re-issued when the
LAN IP changes and when it is within a month of expiring.

Existing installs have a bare certificate and no root. Their first launch after
this update mints the root and replaces the certificate, so a guest who accepted
the old one sees one more warning before installing the root.
