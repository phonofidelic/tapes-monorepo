---
'@tapes-monorepo/core': minor
---

Settings no longer disappear from state while they are still in storage. `readSettingsFromLocalStorage` had an early return taken whenever `audioChannelCount` or `audioFormat` was missing, and that path returned *only* those two keys — dropping everything else the user had saved. With the sync settings now living in the same blob, the cost had grown from a forgotten storage location to a guest device whose `pairingToken` and `syncServerMode` read as unset in the app while storage still held them, so a paired device looked unpaired. Defaults are now merged over the stored object rather than replacing it.

React state is the source of truth: a write persists the whole settings object instead of read-modify-writing storage per key, and it composes off a ref, so two settings changed in the same tick no longer see the second overwrite the first. The stored shape is unchanged — one flat object under `settings`, unset keys absent — which is what the shells parse directly to resolve their sync server.

Reading and writing are wrapped: corrupt JSON in `settings`, or no storage at all, now loads the app on defaults with a warning instead of throwing inside a `useState` initializer and taking the whole app down.

`useSetting` is generic over its key, so its setter takes only values that key allows — `setAudioFormat('xyz')` is now a type error — and `undefined` is the single representation of unset, replacing the `null` that state held but storage never did. `automergeUrl` is dropped from `Settings`; it was never managed here, and `utils.ts` persists it under its own key.
