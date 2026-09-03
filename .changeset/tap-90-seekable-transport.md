---
'@tapes-monorepo/core': minor
---

The player's transport bar is now a seek control instead of a read-only progress line. Reviewing a moment in a long tape meant listening to it from the top: the bar was a 1px `div` whose width was `currentTime / duration`, with no pointer handlers, no keyboard affordance and no hit area, and the only controls were play/pause and stop.

Clicking anywhere on the track seeks, and dragging scrubs — the bar and the elapsed readout follow the pointer while the audio moves on press and on release, with pointer capture so a drag that leaves a 12px strip keeps tracking. The visual track stays a hairline; the interactive strip around it is 12px tall, and the wrapper's full-bleed/`max-w-3xl` arrangement is unchanged. The bar carries `role="slider"` with `aria-valuemin`/`max`/`now`/`valuetext`, takes focus, nudges 5s on the arrow keys and jumps to the ends on Home/End.

Seeking goes through the context rather than the element directly. `clickedTime`/`setClickedTime` — declared, exposed, and never read or written by anything — are gone, replaced by a `seek(time)` that clamps and moves both the element and the transport, and by a `seekableDuration` the bar takes its fraction from. That second value is what makes the control safe on a web-client recording: `duration` is commonly `Infinity` for a MediaRecorder-written `audio/mp4` until the element has seen the whole stream, so `seekableDuration` falls back to `audio.seekable`'s end and to `0` when nothing is addressable. At `0` — and while playback is `loading` or in `error` — the bar renders grey, drops out of the tab order, reports `aria-disabled`, and ignores pointer and key input.

`onEnded` no longer reports `currentTime` as 0 while parking the element at the end. The two disagreed, which was invisible while the bar was read-only and would have made a seek after a natural end start from somewhere the UI never showed. The `key={currentTime}` that remounted the progress div on every `timeupdate` is also gone; it would have fought the drag state.
