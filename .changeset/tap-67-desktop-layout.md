---
'@tapes-monorepo/core': minor
---

The app layout now holds its content to a centred `max-w-3xl` column instead of running edge to edge. The web client used to hide `App` entirely above the `sm` breakpoint, so this layout had only ever been seen at phone widths and inside the Electron window; with that gate gone it needed to survive a 1440px browser. `main` carries the constraint itself rather than an inner wrapper, because the Recorder view positions its visualizer and transport `absolute` against it — a wrapper would have left those full-bleed. The nav bar and audio player stay full-bleed so their backgrounds and borders still span the window, and only their contents follow the column. Below `3xl` nothing binds, so the mobile layout is byte-identical. The Recorder's recording-name bar changes from `fixed w-screen` to `absolute w-full` for the same reason; `main` is itself fixed to the bottom of the viewport, so it resolves to the same place.
