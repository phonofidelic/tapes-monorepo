# Passkey recovery prototype (throwaway)

**This is a throwaway prototype for [TAP-217](https://linear.app/tapes/issue/TAP-217/prototype-passkey-recovery). It is not production code and is not part of any workspace.** Delete it once the recovery method is chosen.

It lets you try two ways a passkey can bring a person's identity back to a phone:

- **PRF unlocks a person key.** The passkey's PRF output decrypts an Ed25519 person key that the host stores wrapped. The person key then signs a device certificate in the provenance format.
- **The passkey is the person key.** The passkey signs the device certificate itself, as a WebAuthn assertion. It asks for Ed25519 first and logs what the provider actually gives.

The guest page records fake audio (random bytes) and signs a real recording claim with the provenance package. The stand-in host checks the claim and its certificate, and shows which person it is linked to.

## What it needs

- **A real domain name over HTTPS.** WebAuthn refuses an IP address as the relying party ID, and phones need a trusted certificate. Pick one setup below.
- **Node 24 and `yarn` run at the repo root**, so `node_modules` exists.
- **Phones signed in to iCloud Keychain or Google Password Manager**, with passkeys syncing. Note which password manager each phone uses.

### Setup A: Cloudflare named tunnel (easiest)

You need a domain on Cloudflare. Quick tunnels (`trycloudflare.com`) get a new name every run, so passkeys made in one run stop working in the next.

1. `cloudflared tunnel login`, then `cloudflared tunnel create tapes-proto`.
2. Route two names to it: `cloudflared tunnel route dns tapes-proto a.proto.<your-domain>` and the same for `b.proto.<your-domain>`.
3. Run `cloudflared tunnel run --url http://localhost:5190 tapes-proto`.

The two names stand for one host on two LAN IPs. Each has its own browser storage. Both use the RP ID `proto.<your-domain>`, so one passkey covers both. The phone needs internet access for this setup.

### Setup B: real subdomain on the LAN

1. Add DNS A records `a.proto.<your-domain>` and `b.proto.<your-domain>` pointing at the laptop's LAN IP.
2. Get a certificate for `*.proto.<your-domain>`, for example with Let's Encrypt DNS-01.
3. Start the server with `PROTO_TLS_CERT=<fullchain.pem> PROTO_TLS_KEY=<key.pem>`.

This is closer to the real rehearsal room, because traffic stays on the LAN. Some routers block DNS answers that point at private IPs. If the name does not resolve on the phone, use setup A.

### What does not work

- **An IP address.** WebAuthn only accepts a domain as the RP ID.
- **Wildcard DNS with the IP in the name**, such as `192-168-1-20.nip.io`. The name changes when the IP changes, so the passkey no longer matches.
- **A quick tunnel.** Its name changes on every run, for the same reason.

## Run it

From the repo root:

```sh
cd prototypes/passkey-recovery
../../node_modules/.bin/vite
```

The server listens on port 5190 (set `PROTO_PORT` to change it). Open `https://a.proto.<your-domain>/host.html?rp=proto.<your-domain>` on the laptop. It shows a QR code for the guest page. Change the origin field to `https://b.proto.<your-domain>` to get the QR code for the "new IP".

Useful query parameters on the guest page:

- `rp=<domain>` sets the passkey RP ID. Without it the page uses its own hostname, which means the two origins would need separate passkeys.
- `alg=es256` makes passkey-as-key ask for P-256 only.

Host state is kept in `.data/state.json`. The **Reset host state** button on the host page clears it.

## Test script

Run each scenario once per approach, with a non-technical person, on their own phone. Start a timer when they get the phone. Write down the time at each step, where they got stuck, and what they had to remember or keep.

### Scenario 1: IP change

1. Scan the QR code for origin `a`. Tap **Create passkey** (PRF or passkey-as-key).
2. Tap **Record (fake) and sign**. The log should say "linked to person ...".
3. Show the QR code for origin `b` and have them scan it. This is the IP change. The page says it made a new device key. Recording now shows "anonymous".
4. Tap the matching **Recover with passkey** button. Then record again. It should be linked to the same person fingerprint as in step 2.
5. If you only have one hostname, tap **Wipe this origin** instead of step 3. It empties the store the same way.

### Scenario 2: new phone

1. Use a second phone signed in to the same Apple or Google account, or a phone they have never used with Tapes.
2. Scan the QR code. Tap **Recover with passkey**. Note whether the passkey is offered at all, and whether they had to use "another device" and a QR code.
3. Record. It should show the same person fingerprint.

### What to note

|                                                         |                                              |
| ------------------------------------------------------- | -------------------------------------------- |
| Phone, OS version, browser                              |                                              |
| Password manager                                        | iCloud Keychain / Google / 1Password / other |
| Algorithm the log reports for passkey-as-key            |                                              |
| PRF: "PRF enabled" value, and any "no PRF output" error |                                              |
| Time from scan to recorded and linked                   |                                              |
| Where they hesitated or got stuck                       |                                              |
| What they had to remember or have with them             |                                              |

Open **What this browser supports** at the bottom of the guest page and copy it into the notes. It lists the client's PRF and related-origins flags, which are hints only.

## Desktop smoke run

`smoke.mjs` drives both approaches in headless Chromium with a virtual authenticator. Start the server, then run from this folder:

```sh
NODE_PATH=../../node_modules node smoke.mjs
```

Set `CHROMIUM_PATH` if Playwright's own Chromium is not installed. This checks the code paths only. It is not a phone test. In Chromium 141 the virtual authenticator returns no PRF output for an imported credential, so the PRF "new phone" step fails there.

The first smoke scenario reports an EdDSA passkey. That comes from the virtual authenticator. iCloud Keychain, Google Password Manager and 1Password are documented as ES256 only, so expect ES256 on phones.

## Relation to the TAP-220 prototype

The recovery API prototype (`prototypes/recovery-api` on its own branch) also wraps an Ed25519 person key with PRF output. The two formats differ:

|                    | This prototype               | TAP-220                                            |
| ------------------ | ---------------------------- | -------------------------------------------------- |
| PRF salt           | `tapes/person-key-wrap@0`    | `tapes/person-key-backup/v1`                       |
| HKDF info          | `tapes person key wrap`      | `tapes/wrap`, plus `tapes/auth` for a server token |
| AES-GCM extra data | none                         | `tapes/v1/<credential id>`                         |
| Stored record      | `{ personKey, iv, wrapped }` | `{ v, alg, iv, ct }`                               |
| RP ID              | `?rp=` or the page hostname  | the page hostname                                  |

A different salt gives a different PRF output from the same passkey. So one passkey cannot open the other prototype's blob. If both paths ship, they should share one format. The TAP-220 format is the better base, because it is versioned and binds the blob to the credential.

`../../node_modules/.bin/vitest run` checks the certificate verifier against a fake authenticator. `../../node_modules/.bin/tsc -p .` type-checks.

## Known limits

- **No pairing token or sync.** The QR code carries only the guest URL. Nothing touches Automerge or the real host.
- **The host API has no auth.** Anyone who reaches it can read the wrapped keys. Fine for a test, never for real use.
- **Passkey-as-key needs the host to keep each passkey's public key.** An assertion does not include the key. On a new phone, the page looks it up by credential ID.
