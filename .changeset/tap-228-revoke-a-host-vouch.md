---
'@tapes-monorepo/core': minor
'electron-client': minor
---

A host operator can now withdraw a vouch the host signed, for a device it confirmed as the wrong person. The host signs a revocation for that vouch and lists it on the recordings whose statements name it. Readers already treat a host revocation like a person's, so a recording the host received first still stands.

The host writes every vouch it signs to the person's roster entry. The waiting requests are dropped after ten minutes, so without that record there was nothing lasting to revoke from. An entry keeps a withdrawn vouch, so the operator can see it was withdrawn.

Settings lists each person's vouched devices under their name, with a button to withdraw one. It runs over IPC in the host's own window, like confirming and rejecting a request, so nothing on the LAN can reach it.
