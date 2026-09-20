---
'@tapes-monorepo/core': minor
---

The electron backend now sends requests with `invoke` and answers them with `handle`, so the reply channels core used to describe are gone.

`IpcRequest` no longer carries a `responseChannel`. The preload bridge exposes `invoke` in place of `send` and `receive`. Both were in core's `Window['api']` declaration, so a platform backend that implements this contract has to change with it.

The response unions are now constructible. A failure carries an error and no `data`, and a success carries `data` and no error, where both branches previously demanded an impossible `never` member. Callers that branch on `success` are unaffected. One that read `error` without checking `success` first must check it now.
