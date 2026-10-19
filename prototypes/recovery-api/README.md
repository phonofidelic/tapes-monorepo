# Recovery API prototype (throwaway)

> **Throwaway prototype for [TAP-220](https://linear.app/tapes/issue/TAP-220).**
> Do not build on it. Delete it once the recovery method is chosen.

A tiny optional service that keeps an encrypted backup of a person key. A
passkey unlocks the backup through the WebAuthn PRF extension. The service
stores only ciphertext, so it cannot read the key. It is for the rare case
where a phone is lost and the host cannot help.

Tapes does not depend on it. This folder is not a Yarn workspace. Nothing in
`apps/` or `packages/` imports it, and turbo, CI and `yarn test` ignore it.

## What it stores

One record per passkey credential id:

| Field      | What it is                                                        |
| ---------- | ----------------------------------------------------------------- |
| `blob`     | The person key's PKCS#8 bytes, encrypted with AES-256-GCM.        |
| `authHash` | sha-256 of an auth token. Only the passkey holder can produce it. |
| timestamps | When the record was created and last replaced.                    |

The browser gets a 32-byte secret from the passkey's PRF output. HKDF splits it
into two keys. The wrapping key encrypts the person key and never leaves the
device. The auth token is sent to the service to prove ownership. The service
cannot turn the auth token back into the wrapping key. The blob is bound to the
credential id, so it cannot be moved to another record.

There is no account, email or name on the service. A passkey is the only login.

## API

| Method   | Path                  | Body       | Result                         |
| -------- | --------------------- | ---------- | ------------------------------ |
| `PUT`    | `/v1/backups/:credId` | `{ blob }` | 201 created, 200 replaced, 403 |
| `GET`    | `/v1/backups/:credId` | none       | 200 `{ blob }` or 404          |
| `DELETE` | `/v1/backups/:credId` | none       | 204 or 404                     |

Every call sends `Authorization: Bearer <auth token>`. A wrong token and a
missing backup both return 404, so the API does not reveal which ids exist.
The first `PUT` for an id claims it. A real service would verify a WebAuthn
assertion at registration too. This prototype skips that.

## Run it

Node 22 or later. No install is needed. It uses Node built-ins only.

```sh
cd prototypes/recovery-api
node src/server.js          # http://localhost:3040
node --test test/*.test.js  # store and fetch round trip
```

`localhost` is a secure context, so passkeys work on the same computer. On a
phone you need a real domain with HTTPS. A passkey's relying party id is the
page's host name. WebAuthn does not accept an IP address there.

Two ways to reach it from a phone without registering anything:

- **A tunnel** such as `cloudflared tunnel --url http://localhost:3040` or
  `ngrok http 3040`. It gives a temporary HTTPS name. Passkeys made under one
  tunnel name do not work under the next, so keep one tunnel for a whole test.
- **Your own domain** with a certificate. Start with
  `TLS_KEY=key.pem TLS_CERT=cert.pem PORT=443 node src/server.js`.

| Variable   | Purpose                                   |
| ---------- | ----------------------------------------- |
| `PORT`     | Listen port. Defaults to `3040`.          |
| `DATA_DIR` | Where records go. Defaults to `./data`.   |
| `TLS_KEY`  | Path to a TLS key. Serves HTTPS when set. |
| `TLS_CERT` | Path to the matching certificate.         |

## How Tapes behaves without it

The prototype is not wired into Tapes, so this is the intended behavior, not a
measured one.

- **Recording and sync** happen on the LAN between guests and the host. They
  never call this service, so it being down changes nothing.
- **The routine re-certify** after a host IP change uses host vouching. It is
  offline and does not touch this service.
- **Total loss without the service** falls back to the passphrase backup. If a
  person has neither, they start a new person key. Old recordings keep their
  old signatures. They just are not linked to the new key.
- **Total loss while the service is down** means waiting, or using the
  passphrase backup. Nothing already recorded is affected.

## Known limits

- **PRF support varies.** iCloud Keychain and Google Password Manager support
  it. Windows Hello needs a 2026 update. Some third-party managers do not
  return PRF output at all. The page says so and stops.
- **Losing the passkey loses the backup.** The PRF output cannot be recreated.
  That is why the passphrase backup should stay as the second path.
- **No rate limits, no abuse checks, no real auth at registration.** A
  production service needs all three.
- **The person key lives in page memory only.** Reloading forgets it. That
  keeps the test honest about what a new phone has.

## Verified so far

- `node --test` passes six round-trip tests over real HTTP, with a faked PRF
  output.
- In headless Chromium with a virtual authenticator that has PRF, the page
  made a key, backed it up, forgot it, and restored the same fingerprint.
- **Not verified:** a passkey synced to a second real phone. The Chromium
  virtual authenticator cannot export its PRF seed, so a copied credential
  returns no PRF output. Only a real phone test can check that path.
- **No user testing has been done.**

## New-phone test script

Run it with someone non-technical, on their own phone, with the service on a
stable HTTPS name. Use iOS Safari with iCloud Keychain, and Android Chrome with
Google Password Manager, if you can.

**Before the session (on phone A):**

1. Open the page. Type a name. Tap **Make a person key**.
2. Write the key label on paper, for example `3f2a-91c0-7be4`.
3. Tap **Back it up with a passkey**. Accept the system passkey prompt.
4. Wait at least a few minutes so the passkey syncs to the cloud keychain.

**During the session (on phone B, which has never opened the page):**

1. Sign phone B in to the same Apple or Google account. If that is not
   possible, note it and stop. That is a finding.
2. Hand them phone B with the page URL. Say only: "Your old phone is gone. Get
   your Tapes identity back."
3. Start a timer when they get the phone. Stop it when the page shows
   "Restored".
4. Check that the label matches the paper.

**What to note:**

| Note                                   | Example                            |
| -------------------------------------- | ---------------------------------- |
| Total time                             | 1 min 40 s                         |
| Where they got stuck, and for how long | Did not know which button to press |
| What they had to remember              | Apple ID password, device passcode |
| What they had to keep                  | Nothing, or the same cloud account |
| Passkey prompts shown                  | Face ID once, or a QR code to scan |
| Platform, OS and browser versions      | iOS 26.1 Safari, Android 16 Chrome |
| Errors in the log                      | Copy the top lines                 |

Also try the failure cases. Stop the server and press **Restore**. Use a
browser or password manager without PRF. Note what the person understood from
the message.

## Per-host names and certificates (design note only)

Not built. A Plex-style scheme would give each host a name like
`192-168-1-20.<host-id>.<domain>`. Public DNS would answer with the private IP
in the name. Each host would get its own wildcard certificate for
`*.<host-id>.<domain>`, issued through ACME DNS-01 with the service writing the
TXT records. This would give guests a stable HTTPS origin across IP changes.
That is out of scope for this issue, and should be its own ticket.

Problems to plan for:

- **DNS rebinding protection.** Many home routers, Pi-hole setups and some ISP
  resolvers drop public answers that point at private IPs. Plex users hit this
  and have to add an exception. Rehearsal rooms often run on such routers.
- **Certificate lifetimes are shrinking.** The maximum is 200 days since March
  2026 and falls to 47 days in 2029. Let's Encrypt moves to 64 days in
  February 2027 and 45 days in February 2028. Hosts must renew on their own.
- **Let's Encrypt rate limits.** 50 new certificates per registered domain per
  week. Renewals through ARI are exempt. Many hosts would need a higher limit
  or a Public Suffix List entry for the domain.
- **The host must be online to renew.** An offline host's certificate expires.
  Tapes must still fall back to the current LAN-IP origin then.
