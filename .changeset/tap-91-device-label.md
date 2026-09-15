---
'@tapes-monorepo/core': minor
---

A guest now tells the host what to call it when it opens the sync socket. The name rides the upgrade request as `?d=`, next to the pairing token. The host reads it in the upgrade handler, so it has a name for every connection it accepts.

The default name is derived from the user agent, such as "iPhone · Safari". Settings has a field to change it. The name is stored per device, not in the Automerge document. What one phone calls itself is not a fact about the library. The desktop app names its connections too, including the one to its own embedded server. Renaming reconnects, so the host sees the new name without a restart.

The name is untrusted display text. Both sides cap it at 64 characters and strip control, formatting and line-separator characters. A guest cannot forge a log line or reorder the text around its name. The name is also unverified. Two devices can claim the same one.
