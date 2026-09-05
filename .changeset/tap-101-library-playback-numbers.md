---
'@tapes-monorepo/core': minor
---

Show plays and average completion on each recording in the Library.

Each row now carries a quiet line next to its duration: the number of plays, and
how far through the recording those plays got on average. The counts come from
the aggregates the host serves, so no extra request is made per row.

Three states are shown differently on purpose. A host that answers with no plays
for a recording reads as "0 plays". A host that has not answered reads as "Plays
unknown", never as a zero. A single play is reported without the word average,
because one measurement is not one.
