---
'@tapes-monorepo/core': minor
---

Queues finished play sessions on the device and flushes them to the host that owns the recording's library, so a play survives being offline and survives a reload.

A play is measured where it happens and counted somewhere else, and the two are often not in touch — the phone that wandered off the LAN mid-listen is exactly the play the host most wants counted. So a session is not sent, it is queued in device storage, alongside pins and for the same reason: an unsent local queue is not a fact about the library, and putting it in the Automerge doc would sync one phone's pending sends to every peer.

The queue is kept per host, so a reachable host can be flushed while another is away, and which host counts a given play goes through a single `resolveEventTarget`. There is no ownership record yet, so that function holds the interim rule — the remote edge when the device has one, else this device's own host — and it is the only thing that changes when the real ownership lookup lands.

The queue clears itself strictly against the host's per-event answer: accepted and already-seen events are dropped, non-retryable rejections are dropped, and everything else stays, including an event whose recording has not finished syncing to the host yet. A whole flush is one request rather than one per event, because the host rate-limits per connection and a phone carrying a week of plays would spend that budget in seconds. When a host cannot be reached, retries back off from five seconds to five minutes with jitter, but the ordinary way a queue drains is opportunistic: coming back online, returning to the foreground, pairing with a host, or simply finishing a play.

Two details worth naming. Event ids come from `crypto.randomUUID` where it exists and from `getRandomValues` where it does not — the plain-HTTP LAN mode the host can be configured into is not a secure context, the same restriction that keeps `crypto.subtle` out of the blob client. And the queue is capped per host, dropping oldest first: a phone that never sees its host again must not grow this forever.
