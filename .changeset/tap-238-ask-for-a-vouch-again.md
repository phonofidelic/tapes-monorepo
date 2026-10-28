---
'@tapes-monorepo/core': minor
---

A guest the host vouched for can now ask for another vouch. Settings offers the ask in the person key section, next to restoring from a backup. The device already knows which person it is, so it needs no list of names. It reads that person's entry from the host's roster and sends the same request the welcome flow sends. The operator confirms it, or the person types their PIN.

Until now the ask only appeared on a device with no keys at all. A device whose vouch the operator withdrew had one way back. It had to clear its key store, which also discards the device signing key that signed every recording it had made.

A new vouch replaces the one the device held. The old vouch still stands for the takes signed under it. Nothing yet tells a device that its vouch was withdrawn, so the ask is offered whenever the host still has the person on its roster. A device the host no longer lists is told to see the operator in person, because the host refuses a request for a person it does not know.
