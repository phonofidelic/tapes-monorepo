---
'electron-client': minor
---

Gives the host a durable place to keep playback events. Accepted events are appended to a log on the host's own filesystem, next to the blob store, and survive a restart — which is what lets aggregates be recomputed from scratch rather than kept as merged counters no concurrent writer could ever repair.

The log is never rewritten, only appended to and swept a whole day at a time, so an unclean quit can leave at most a torn final line, which every reader skips. Event ids are indexed in memory when the store opens, so a retried flush after a lost response is recognised as a duplicate without reading the log.

Events are kept for 90 days. That sweep rides the same startup moment as the blob store's `tmp` sweep instead of getting a scheduler of its own, and keys on the host's clock rather than the guest's, so a device with a badly wrong clock cannot hold its events past every sweep or lose them before they are counted.
