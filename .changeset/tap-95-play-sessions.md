---
'@tapes-monorepo/core': minor
---

Measures play sessions in `AudioPlayerContext`, the first half of counting how far a shared recording actually got listened to. A session opens when playback starts on a recording and closes on pause, a natural end, a change of recording, or the provider unmounting — the last of which is how most plays end. It reports through a new optional `onPlaySession` prop, and only once it accumulated five seconds of real playback, so a scrub or a mis-tap is not a play. The reported `completion` is the high-water mark of `currentTime` over the session, clamped to `[0, 1]`: re-listening to a passage cannot push a play past 100%, and a seek is never counted as listening. A session whose recording has no addressable length — the `Infinity` duration a MediaRecorder-written mp4 reports until it has been played through — is dropped rather than reported as an invented percentage. Nothing consumes these yet; the queue that carries them to the host comes next.
