---
'@tapes-monorepo/core': minor
---

`App` no longer builds the Automerge `Repo`. Each shell now constructs its own and passes it in as `repoContextValue` (`null` while bootstrapping), because storage and network adapters are platform-specific: the web client persists to IndexedDB, while the electron renderer runs without a storage adapter and lets its embedded sync server persist to the filesystem. The `syncServerUrl` prop is gone — nothing in core used it once the repo moved out.
