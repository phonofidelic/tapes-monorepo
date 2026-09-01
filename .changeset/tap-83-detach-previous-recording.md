---
'@tapes-monorepo/core': patch
---

Selecting a recording now detaches the audio element before resolving the new source, so a recording that cannot be resolved no longer plays the previously loaded one.

Resolution is asynchronous and can end in `error` (a guest with the host offline and nothing cached), but the element kept the previous recording's `src` throughout. The player showed the new recording's name and "Not available offline" while happily playing the last tape. The player now also stops the transport when resolution fails, and the resolution path no longer bails out on a recording with no local `filepath` — a recording synced from another device is resolved from the cache or the host as it should be.
