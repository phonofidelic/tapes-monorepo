---
'electron-client': patch
---

The desktop host now signs one receipt per claim. When the same claim arrives again, for example on a retried upload, the host answers with the receipt it signed the first time. The receipt's time therefore stays the first arrival, and the recording's attestations list stays the same across retries.

The blob store keeps a small index from each claim's hash to the receipt the host signed for it. The host signs a new receipt when the indexed one is no longer stored or was signed with a different host key.
