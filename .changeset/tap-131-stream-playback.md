---
'@tapes-monorepo/core': minor
---

Playback now streams a recording from the host instead of downloading the whole file first. The audio element is pointed at the host's `/blobs` URL and range-requests what it needs, so nothing has to fit in memory before the first sample plays. Long recordings on a phone were the bad case.

The first three resolution steps are unchanged: legacy embedded bytes, the local cache, then this device's own copy. The fourth now splits. The player streams when a service worker is controlling the page, because only then can a bare element request carry the pairing token. It picks the host with a HEAD request, which fails over between hosts without moving any bytes. Everything else keeps the whole-body fetch, including a host on an origin the worker does not cover.

Playing a recording no longer writes the local blob cache or replicates bytes to hosts that lack them. Streaming never holds the bytes, so pinning is now the only thing that does either. Pinning already cached and replicated, so the offline story is unchanged for anything the user pinned.

A media error now sets the playback state exactly as a failed fetch does. It was only logged before, which was survivable when a failure meant a bad object URL. A streamed source can fail at any point during playback.

Cache eviction can no longer select anything, since every remaining entry is pinned and pinned entries are exempt. That code is left in place.
