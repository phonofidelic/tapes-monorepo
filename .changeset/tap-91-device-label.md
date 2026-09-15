---
'@tapes-monorepo/core': minor
---

A guest now tells the host what to call it when it opens the sync socket. The name rides the upgrade request as `?d=`, next to the pairing token. The host reads it in the upgrade handler, so it has a name for every connection it accepts.

The default name is derived from the user agent, such as "iPhone · Safari". Settings has a field to change it. The name is stored per device, not in the Automerge document. What one phone calls itself is not a fact about the library. The desktop app names its connections too, including the one to its own embedded server. Renaming reconnects, so the host sees the new name without a restart.

The name is untrusted display text. It is capped at 64 characters, and control, formatting and line-separator characters are stripped. A guest cannot forge a log line or reorder the text around its name. The name is also unverified. Two devices can claim the same one.

Those rules live in a new package, `@tapes-monorepo/sync-protocol`. Guests build a name and the host re-sanitizes whatever arrives, so both sides have to agree on what a name may contain. The Electron main process cannot import `core`, whose entry is the React app, so the shared rules get their own plain TypeScript package rather than a copy on each side.
