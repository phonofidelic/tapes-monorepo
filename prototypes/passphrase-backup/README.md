# Passphrase-wrapped backup (throwaway prototype)

> **Throwaway.** This folder exists to test one recovery option for
> [TAP-218](https://linear.app/tapes/issue/TAP-218). It is not production code,
> it is not a Yarn workspace, and nothing in the app imports it. Delete it once
> the recovery method is chosen.

It lets a person create an Ed25519 person key, lock it with a passphrase, and
save it as a file or a QR code. On another origin or phone they bring the
backup back by file, photo, or camera scan, type the passphrase, and get the
same key. A benchmark page times the key derivation on the device it runs on.

It reuses `packages/provenance` from source for base64url, key fingerprints and
signing. It does not touch the real app, the host, or pairing.

## Run it

The folder has its own `package.json` and lockfile. Install from inside it.
Run the root `yarn` once first. The provenance source's tsconfig extends a
workspace package, and tests and builds fail without it.

```sh
yarn              # at the repo root, once
cd prototypes/passphrase-backup
corepack enable
yarn
yarn dev          # https://<lan-ip>:5199, self-signed
```

- **Phone access.** Open the `Network` URL Vite prints on the phone. Accept the
  self-signed certificate warning. HTTPS is needed for the camera and for
  WebCrypto.
- **A second origin on one machine.** Run `yarn dev:second` (port 5200) in another
  terminal. Each port is its own IndexedDB store, just like a new host IP.
- **Other commands.** `yarn test` runs the unit tests. `yarn check-types` and
  `yarn build` check the pages compile. `yarn bench:node` prints a desktop
  timing baseline. `yarn qr-size` prints the QR version per error correction
  level.

## Pages

| Page           | What it does                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`   | Create a key. Pick a generated six-word passphrase or your own. Lock it. Save the file (share sheet or download) and show the QR. Then type the passphrase again to check it. |
| `restore.html` | Scan the QR with the camera, pick a file or a photo of the QR, or paste the text. Type the passphrase. The restored key is saved for this origin.                             |
| `bench.html`   | Times every KDF setting below in a worker, 3 to 10 runs each. "Copy results" puts a text report on the clipboard for the ticket.                                              |

Each page keeps an event log at the bottom with timings. Screenshot it after a
test run.

## Backup format, version 1

One binary record. Big-endian integers.

| Bytes | Field                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------ |
| 1     | Format version, `1`                                                                                    |
| 1     | KDF id. `1` is PBKDF2-HMAC-SHA256. `2` is Argon2id v1.3.                                               |
| 4     | PBKDF2: iterations. **Or**, for Argon2id, 4 bytes memory in KiB, then 1 byte passes, then 1 byte lanes |
| 16    | Random salt                                                                                            |
| 12    | Random AES-GCM nonce                                                                                   |
| 32    | Ed25519 public key, in the clear                                                                       |
| 48    | AES-256-GCM ciphertext of the 32-byte private key seed, plus the 16-byte tag                           |

- **Encryption.** The KDF output is a 256-bit AES-GCM key. All bytes before
  the ciphertext are the GCM additional data. Changing the parameters or the
  public key makes unlocking fail.
- **Passphrase.** It is normalized before derivation: NFKC, lowercase, runs of
  spaces, dots, commas and underscores become one space, then trimmed. Phone
  keyboards add capitals and double spaces, and these should not lock anyone
  out.
- **Public key in the clear.** The restore page can show whose key it is
  before asking for the passphrase. It also lets unlocking check that the
  decrypted seed really matches.
- **Size.** 114 bytes for PBKDF2 and 116 for Argon2id.

It travels in two forms:

- **Text, used for the QR.** `TPK1.` then the record in unpadded base64url.
  That is 157 or 160 characters. At error correction M this is a version 9
  QR, 53 by 53 modules. A pairing QR is about the same size.
- **File.** A `.txt` file holding a small JSON object. It has the `format`
  name, `version`, `createdAt`, the public key, the text form in `backup`, and
  a one-line help message. It is `.txt` because Chrome's Web Share refuses
  `.json` files.

The parser never throws. It returns a reason for anything it rejects. It
refuses unknown versions, unknown KDFs, Argon2id memory outside 8 MiB to
1 GiB, and wrong lengths.

## Proposed KDF settings

| Setting                           | Why                                                                   |
| --------------------------------- | --------------------------------------------------------------------- |
| **Argon2id, 64 MiB, t=3, p=1**    | RFC 9106's second recommended option. Memory-hard, so GPUs gain less. |
| PBKDF2-SHA256, 600,000 iterations | OWASP's current floor. Native WebCrypto, no WebAssembly.              |

The benchmark also runs PBKDF2 at 1.2M, Argon2id at OWASP's minimum
(19 MiB, t=2), at 46 MiB t=1, and at 128 MiB t=3, so you can see the curve.
The Argon2id code is [hash-wasm](https://github.com/Daninet/hash-wasm). Its
worker chunk is about 11 kB gzipped.

**Target:** derivation under about 2 seconds on a mid-range phone. If 64 MiB
fails or takes much longer, try 46 MiB t=1 next.

### Node baseline (not a phone)

`yarn bench:node 5` on a 2-core Xeon at 2.1 GHz, Node 22.22. This is a cloud
VM, not a phone. Phones are expected to be several times slower, and Node's
PBKDF2 is native OpenSSL rather than the browser's WebCrypto.

| Setting                       | Median | Min to max |
| ----------------------------- | -----: | ---------- |
| PBKDF2, 600k (proposed)       | 116 ms | 101–119    |
| PBKDF2, 1.2M                  | 225 ms | 210–239    |
| Argon2id, 19 MiB, t=2         |  81 ms | 75–113     |
| Argon2id, 46 MiB, t=1         | 130 ms | 117–167    |
| Argon2id, 64 MiB, t=3 (prop.) | 311 ms | 274–395    |
| Argon2id, 128 MiB, t=3        | 601 ms | 527–726    |

## Phone test script

Use a mid-range phone, not a flagship. Use a non-technical person for steps
2 and 3. Write down everything in **What to note**.

### 1. Benchmark (you, about 5 minutes)

1. Run `yarn dev` on the laptop. Open `https://<lan-ip>:5199/bench.html` on
   the phone.
2. Set 5 runs. Tap **Run benchmark**. Keep the screen on.
3. Tap **Copy results** and paste them into the ticket. Note the phone model.
4. Repeat on one iPhone and one Android phone if you can.

### 2. Scenario: IP change

This copies what happens when the host moves to another network. The new
origin starts with an empty IndexedDB.

1. On the laptop, run `yarn dev` (port 5199). Give the phone the URL.
2. The person opens it, taps **Create identity**, makes a backup, and saves
   it in whatever way they choose. Let them choose. Do not suggest one.
3. They do the passphrase check in step 4 of the page.
4. Stop the server. Start `yarn dev:second` (port 5200). Or switch the laptop to
   another network so the IP changes.
5. Give the person the new URL and open `restore.html`. Say only "get your
   identity back".
6. Success is when the page shows the same fingerprint as before.

### 3. Scenario: new phone

1. Do the backup on phone A as above.
2. Let time pass if you can. A day or more is best. Do not remind them.
3. Give them phone B, which has never opened the prototype. Open
   `restore.html` on it.
4. Say only "get your identity back on this phone".
5. If they saved the file only on phone A, note it. That is a finding, not a
   failure of the test.

### What to note

- **Time.** From opening the restore page to success. The page log has it.
- **Where they got stuck.** Note the exact step and what they said.
- **What they had to keep.** File, screenshot, photo, printout, message to
  self, or nothing.
- **Where they put it.** Files app, Photos, Downloads, Drive, email, paper.
  Could they find it again?
- **Passphrase.** Generated or chosen. Did they write it down, and where? How
  many unlock attempts did it take?
- **File vs QR.** Which one did they pick to save? Which one did they use to
  restore?
- **Prompt timing.** Would they have made a backup if the page had not asked
  right away? Ask them.
- **Device and browser.** Model and OS for each phone.

## Known limits

- The person key is stored per origin in IndexedDB, extractable. A real
  version would decide what storage and extractability the person key gets.
- No device certificate is made. That is out of scope here.
- Camera scanning uses the native BarcodeDetector where present, which is
  Chrome on Android. iOS Safari has it disabled by default, so it falls back
  to jsQR, which is slower.
- No strength check for chosen passphrases beyond a length floor.
