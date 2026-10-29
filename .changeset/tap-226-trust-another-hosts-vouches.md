---
'@tapes-monorepo/core': minor
---

A host's operator can now say they trust another host's key, and that host's vouches then count as the person's own. The Library named a vouched person with the host that signed the vouch, as "Sam, vouched by Studio Mac", and had no way to ever drop the second half. A vouch from a trusted host is now shown as "Sam", and its details say that the operator trusts that host. A vouch from any other host reads exactly as before.

The operator starts trusting a host from the vouch itself, in a recording's details in the Library, which is where the host's key and its label come from. Settings lists the trusted hosts by key fingerprint and label, with a button to drop one. Only the desktop app offers either: which hosts count decides what a host's recordings say about people, so a guest reads the vouch without making that call.

The list is kept per device, next to the offline pins, because whom to believe is the reader's decision and not a fact about the root document. The provenance package is unchanged. It still reports the host key behind a vouch and takes no view on it. A device certificate needs none of this: the person key signed that itself, and a claim that names one names no vouch.
