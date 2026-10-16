---
'@tapes-monorepo/core': minor
---

A recording pinned with "Keep offline" now keeps its signed statements on the device as well as its audio. Its provenance can then be checked with every host switched off, instead of showing "can't check right now".

The provenance check reads a pinned statement from the device before asking any host. Unpinning removes the statements, except any that another pinned recording still lists, such as a shared session record.

This applies to the web client. The desktop app already copies a pinned recording's statements into its own host store, which serves them locally.
