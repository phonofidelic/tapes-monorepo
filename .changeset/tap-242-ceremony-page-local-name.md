---
'@tapes-monorepo/core': minor
---

The passkey ceremony page now leads with the name the operator gave their host, where they gave one.

Until now the page could only show the host's own name for itself, beside the origin it was talking to. Nothing verifies that name. A name the operator typed on the device that is asking is the one thing on the page that is recognition rather than a claim, so it goes first. The claim and the origin stay underneath it.

The page runs on another origin and cannot read the app's stored names. So the request a guest posts carries a new optional field, `knownAs`, holding the local name for the pinned host key. The protocol version stays at 1. Both sides reject a message whose version is not exactly 1, so a bump would drop requests with no error on either side. The field is additive, and a page that does not know it ignores it.

A guest that named no host sends nothing and sees the page exactly as it was. The only place a guest can name a host key today is the Library provenance view, and it offers one for a host that appears in a recording's vouch. A guest that has seen no vouched recording therefore has no name to send.
