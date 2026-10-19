# Host vouching prototype (throwaway)

**Throwaway prototype for [TAP-219](https://linear.app/tapes/issue/TAP-219). Not production code.**
Nothing in `apps/` or `packages/` imports it. Delete the folder once the test is done.

When the host's LAN IP changes, every guest's origin changes, so every guest
loses its IndexedDB and its device key. This prototype tests the recovery: the
guest re-scans the QR code, picks their name, and the host vouches for the new
device key once the operator confirms in the room or the person types a PIN.

## The design in short

- **The host signs a vouch, not a certificate.** A vouch says "this host saw the
  person who holds person key P take up device key D". The host never holds the
  person key. See `lib/statements.ts`.
- **The vouch points back to the person.** It carries the address of the
  certificate the person key signed when they first joined this host.
- **Operator confirmation is the default.** One tap per person on the host. The
  host shows each request with its name, device and key fingerprint.
- **A PIN is optional.** 4 to 6 digits, stored as a salted PBKDF2 hash.
  Five wrong tries lock the PIN path for that person, counted per person, not
  per device. The operator can unlock it. The operator path is never locked.
- **Guests pin the host key.** The QR link carries the host's public key
  (`hk`). The guest checks every vouch against it.

## What is real and what is faked

| Part                            | In the prototype                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical JSON, Ed25519 signing | Real, from `packages/provenance`                                                                                                                                      |
| Host key in the OS keychain     | Faked: a JSON file in `.data/`                                                                                                                                        |
| Person key                      | Faked: generated on first join, kept in the same IndexedDB, so it is lost on the origin change. Where it really lives is the passkey and backup prototypes' question. |
| IP change                       | Faked by moving to the next port. A new port is a new origin, so the guest store is empty, as after a real IP change. The button also re-reads the LAN IP.            |
| Sync, recording, TLS root       | Not included. The guest page uses a throwaway self-signed certificate.                                                                                                |
| PIN lockouts                    | In memory. A restart clears them.                                                                                                                                     |

## Run it

On the host Mac, from the repo root:

```sh
corepack enable && yarn            # once
node prototypes/host-vouch/run.mjs # --port 9443 --operator-port 9400
```

- Open the operator page at `http://localhost:9400/` on the host. It shows the QR code.
- Phones must be on the same Wi-Fi. They scan the QR and tap through the
  certificate warning ("Show details" then "visit this website" on iOS Safari).
- Data lives in `prototypes/host-vouch/.data/`. "Reset all prototype data" on the operator page clears it.

Unit tests and type-check:

```sh
node node_modules/vitest/vitest.mjs run --root prototypes/host-vouch
node node_modules/typescript/bin/tsc -p prototypes/host-vouch/tsconfig.json
```

## Test script

Use real phones and non-technical people, in the rehearsal room. Ideally the
whole band. Have one person play the operator at the host.

**Before the session**

1. Start the prototype. Each person scans the QR and taps "I'm new here".
2. Each person types their name. Give one or two people a PIN, leave the rest without.
3. Check every phone shows "Welcome". Then close the tabs.

**The scenario, timed**

1. Press "Origin changed: refresh QR" on the host. Optionally move the host to
   another network first, such as a phone hotspot.
2. Start a stopwatch. Everyone scans the new QR at the same time.
3. Each person taps their name.
4. The operator confirms each one. People with a PIN try the PIN instead.
5. Stop the stopwatch when the last phone shows "You're in as …".
6. Try one wrong PIN on purpose, then the right one. Try five wrong PINs on one
   person and have the operator unlock it.
7. Have someone tap another person's name. Does the operator notice and press "No"?

**Write down**

- Total time for the whole band, and the "Waited" column on the host for each person.
- Time from scan to the name list, including the certificate warning.
- Where anyone got stuck or asked a question, and what they said.
- What anyone had to remember or keep: their PIN, their own name in the list, nothing else?
- Whether the operator could tell whose phone was whose with four or five at once.
- Whether "Confirm everyone listed" felt safe, or whether people want one tap each.
- Phone models and browsers.
