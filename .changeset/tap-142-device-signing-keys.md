---
'electron-client': minor
'web-client': minor
---

Every device now has its own Ed25519 signing key, created on first launch. Nothing signs with it yet.

The desktop host encrypts its key with Electron's safeStorage, whose key is held in the macOS Keychain. The encrypted file lives in `userData/provenance`, apart from the TLS root CA key. If the file cannot be decrypted, the host logs an error and leaves the file alone rather than replacing it.

A browser guest generates a non-extractable key and stores the `CryptoKey` in IndexedDB, so the private key never exists as bytes the app can read. A guest whose browser lacks Ed25519 logs a warning and keeps recording. Guest keys are lost when the host's LAN IP changes, because the guest's origin changes with it.
