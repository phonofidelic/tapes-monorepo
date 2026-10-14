---
'@tapes-monorepo/core': minor
---

Core can now check what a recording's signed statements prove. `checkRecordingProvenance` fetches each listed statement from every known host and passes them to the provenance package's verifier. A statement no host could serve counts as not fetched, so the result is "can't check right now" rather than failed. Statements whose bytes match their hash are cached for the session. The Library reads the result through the new `useRecordingProvenance` hook.
