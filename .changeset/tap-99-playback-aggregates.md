---
'electron-client': minor
---

Turns the host's playback-event log into the two numbers the feature promises: plays and average completion, per recording.

Average completion is the mean of the per-play completion values, not total-listened over `plays × duration`. The two diverge as soon as anyone replays a tape, and only the per-play mean answers "did people sit through it". Each recording therefore carries a sum and a count rather than a pre-divided average, since two averages cannot be combined without their weights.

Nothing here is a merged counter. Every number is a fold over the log, so a rollup that is lost, stale or corrupt is a rebuild rather than a permanently wrong count — the rollup exists only so a read does not pay for a replay. It is derived once when the host starts, updated incrementally as events are accepted, and can be rebuilt on demand.

Retention would otherwise eat into these numbers: a host looking at an old tape wants its lifetime play count, and a number that silently decreases as events age out is worse than no number. So an expiring day of events is folded into a frozen baseline and that baseline is persisted *before* the events are unlinked, with every rollup starting from it. A crash anywhere in that sequence loses nothing — the events stay on disk until the last step, and a segment that is briefly in both places is counted once. If the baseline cannot be written, the expired events are kept and swept on a later pass, since deleting them after failing to freeze them would lose those plays from both places at once.
