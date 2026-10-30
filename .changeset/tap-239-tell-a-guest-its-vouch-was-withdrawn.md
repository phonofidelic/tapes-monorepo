---
'@tapes-monorepo/sync-protocol': minor
'@tapes-monorepo/core': minor
'electron-client': minor
---

A guest is now told when the host withdrew the vouch its device holds. Settings says so in the person key section, and the ask that was already there becomes the next step rather than an unexplained offer.

The signal comes from a new route on the host. A guest reads the state of one vouch by its statement address, and the host answers that it stands or when it withdrew it. The device holds that vouch already, so this hands it nothing new, unlike reporting every person's device keys on the roster route. A host that knows no vouch at that address, as after its roster was replaced, answers the same way as one whose vouch stands: only a withdrawal is worth telling the person about.

Until now nothing reached the device. The host marked the vouch on the person's roster entry and listed the revocation on the recordings whose statements name it, so only a reader of those recordings saw the withdrawal.

A withdrawn vouch still stops nothing. The device records and syncs as before, and readers judge its takes by when the host received them.
