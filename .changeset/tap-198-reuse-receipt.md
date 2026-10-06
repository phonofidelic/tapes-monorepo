---
'electron-client': patch
---

The desktop host now returns its existing receipt when a claim it already receipted is uploaded again. Before, a retried upload got a newly signed receipt with a later arrival time. The recording then showed the retry's time instead of the first arrival.

The blob store keeps a small index from a claim's hash to the hash of this host's receipt for it. The receipt is reused only if it is still in the store and verifies against the host's current key. Storing it again adds the new document as an owner.
