---
'@tapes-monorepo/core': minor
---

Importing a host URL in Settings now takes effect immediately instead of on the next launch. `setAutomergeUrl` only wrote `localStorage`, and every reader — `Library`, `Recorder`, and the shells that build the repo around this url — re-read that value during render with nothing to tell them to render again. Pasting a pairing link and clicking Import therefore changed nothing on screen: no library, no error, no confirmation, even though the import had in fact worked.

`useAutomergeUrl` is now backed by `useSyncExternalStore` over a module-level listener set, the same seam `subscribeToSettingsChange` already uses for the sync settings the shells read from above the React tree. A write re-renders the readers, so the desktop shell rebuilds its repo against the imported document (its effect was already keyed on this url) and the web client finds the document through the repo it already has — its adapters are unchanged, so nothing there needs rebuilding.

`setAutomergeUrl` also drops the `am` query parameter it supersedes. That parameter is a bootstrap seed a pairing link leaves in the address bar, and it takes precedence over storage — so on a guest opened from a QR code, importing a different document would have gone on being invisible.

Two smaller fixes in the same flow: the import button now confirms what happened rather than succeeding silently, and a pasted pairing link's `pt` token is kept instead of discarded. Without that token the imported document resolves to an id this device can open neither the host's sync socket nor its `/blobs` for.
