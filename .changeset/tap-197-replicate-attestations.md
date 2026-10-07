---
'electron-client': minor
'@tapes-monorepo/core': minor
---

When "Keep offline" copies a recording's audio to a host that lacked it, the recording's signed claim and receipt are now copied too. The client sends the audio first, then claims, then receipts.

The desktop host's `/blobs` upload route now accepts `application/json` uploads of signed statements. It stores one only if it is in canonical form and binds to what the host already holds. A claim needs its audio on the host with the same hash and size. A receipt needs its claim stored on the host and a valid signature. Anything else is answered with 422 and the reason.
