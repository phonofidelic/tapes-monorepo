---
'@tapes-monorepo/core': minor
'electron-client': minor
'web-client': minor
---

Each recording in the Library now says what its signed statements prove. There is plain wording for each state: verified, signed on the device only, not signed, failed, and can't check right now. A short line sits under the row, and it opens to show the times and session.

The recording device is named by a short key fingerprint, or "this device" when it signed with this device's own key. The claim's times are labelled as the device's clock and the receipt's time as the host's clock. A receipt the host signed for its own recording is shown as "recorded by the host", not as separate confirmation.

To say "this device", core asks the platform for the local public key. The web worker answers a new `provenance:device-key` request. The desktop answers on a new `provenance:get-device-key` IPC channel with the host key it signs claims with.
