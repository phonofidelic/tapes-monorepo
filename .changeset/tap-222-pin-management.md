---
'@tapes-monorepo/sync-protocol': minor
'@tapes-monorepo/core': minor
'electron-client': minor
---

Wrong PIN counts are now saved in the host's roster, so restarting the host no longer resets a person's attempt limit. The host's Settings lists the people on its roster. The operator can unlock a locked PIN, set a new one or remove it there.

A guest can set, change or remove their PIN from Settings. A device with the person key re-joins with the new PIN, and a join may now send `null` to remove it. A vouched device gives its old PIN to the new `/people/pin` route, and a wrong old PIN counts against the same limit.
