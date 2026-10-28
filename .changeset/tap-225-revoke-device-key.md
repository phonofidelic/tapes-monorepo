---
'@tapes-monorepo/provenance': minor
'@tapes-monorepo/core': minor
'electron-client': minor
'web-client': minor
---

A person can now say that one of their device keys should no longer be trusted, for a phone that was lost or stolen. The provenance package adds a revocation statement that withdraws a device certificate or a host vouch. A person key signs it for a certificate it issued, or for a vouch made in its name. A host signs it only for a vouch it signed itself.

The verifier treats a revoked vouch exactly like a revoked certificate. A revocation does not cancel a recording. The line between takes to keep and takes to doubt is the host's receipt time, because a lost device's own clock proves nothing. A recording a host received before the revocation still stands. One it received later, or one no host ever received, is reported as in doubt.

A revocation covers a device rather than one take, so the Library lists it on every recording whose statements name the statement being withdrawn. It is copied to hosts under each of those recordings, so a host keeps it as long as it keeps them. Hosts accept a copied revocation once they hold the certificate or vouch it withdraws, which is also how it reaches a second host.

The Library's provenance details offer the revocation on a recording made by another device that this person's key stands behind. Copying statements to a second host now tags a vouch with the claim that names it, as it already did for a certificate.
