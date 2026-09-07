---
'electron-client': minor
'web-client': patch
---

Serve the host's root certificate so a guest can install it once

With LAN HTTPS on, the host now answers `GET /ca.crt` with its root
certificate, and `GET /trust` with a short page that links to it and gives the
install steps for iPhone, iPad, Android and Mac. The page prints the
certificate's SHA-256 fingerprint so the person installing it can check it
against the host before trusting anything.

Neither route asks for the pairing token. The root certificate is the one thing
every guest is meant to hold, and a guest that has not trusted the host yet is
exactly who needs to reach it.

The private key is never served. Only the certificate leaves the host.

With HTTPS off there is no certificate, so `/ca.crt` answers 503 and the page
points to the browser click-through instead.
