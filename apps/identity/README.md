# identity

The passkey ceremony page, served at `https://identity.tapes.network`. It is
the only part of Tapes with a domain name.

A guest loads Tapes from the host's LAN IP, and WebAuthn refuses an IP address
as a relying party id. So the guest page opens this page in a new tab, this
page runs the passkey, and the result goes back to the opener with
`postMessage`. Recording, syncing and the host vouch never load it. With this
domain unreachable, everything except passkey recovery works as before, and the
passphrase backup still restores a person key on its own.

## What is in here

| File                    | What it is                                                    |
| ----------------------- | ------------------------------------------------------------- |
| `public/index.html`     | The page. No inline script or style, so the CSP stays strict. |
| `public/ceremony.v1.js` | The ceremony. Plain browser JavaScript, no build step.        |
| `public/style.css`      | Enough CSS to read it on a phone.                             |
| `public/_headers`       | Response headers for Cloudflare Pages.                        |

There is no bundler and no server. What is in `public` is what is served.

## The relying party id is `tapes.network`

Not `identity.tapes.network`. It is the registrable domain, so another
subdomain can serve this page later without invalidating a single passkey. The
page refuses to run anywhere outside `tapes.network` and `localhost`, which
keeps a copy served elsewhere from binding passkeys under the wrong id.

The relying party id can never change. Losing the domain means passkeys stop
unlocking, which is why the passphrase backup stays an equal path.

## The message protocol

Version 1. The guest side is `packages/core/app/personKeyCeremony.ts`, which
mirrors these shapes because it cannot import them.

1. The guest opens `https://identity.tapes.network/#o=<its own origin>` in a
   new tab, on a tap. A fragment is not sent to the server and stays out of the
   referrer.
2. The page posts `{ type: 'ready' }` to that exact origin. A page that lied
   about its address gets nothing, because the browser drops the message.
3. The guest replies with `{ type: 'request', nonce, action, hostName, … }`.
   The page checks that the message really came from the origin in the
   fragment, then shows that origin and the host's claimed name and waits for a
   tap.
4. The page runs `navigator.credentials.create` or `.get` with the PRF
   extension, and posts back `{ type: 'result', credentialId, rpId, prf }` or
   `{ type: 'error', reason }`.

The PRF salt is `tapes/person-key/v1`, from Person key wrapping format v1. The
page derives nothing and wraps nothing. It hands back the PRF output, and the
guest does the HKDF and the AES-GCM work with the person key it already holds.

The page keeps no state of its own. One request per page load, so a confirmed
tap cannot be reused.

## Changing it

This is trusted code for key material. Hostile code at this origin could ask a
person to unlock their person key behind a Face ID prompt.

- Keep it small and dependency free.
- Add `ceremony.v2.js` beside the version 1 file rather than editing version 1,
  once real passkeys are bound to this origin. Old guests keep working.
- `yarn workspace identity check-types` type-checks the page. `yarn dev` serves
  `public` on port 3003, where the relying party id falls back to `localhost`.

## Serving it

Done once, by hand, outside this repo. The domain is at Cloudflare.

1. **Before the first passkey is bound to the domain:** turn on registrar lock
   and DNSSEC, and set a long registration. Whoever holds `tapes.network`
   controls every passkey bound to it.
2. Create a Cloudflare Pages project from this repository. Build command: none.
   Build output directory: `apps/identity/public`.
3. Add `identity.tapes.network` as a custom domain on the project. Cloudflare
   issues and renews the certificate.
4. Check the response headers against `public/_headers`. The one to confirm is
   `Cross-Origin-Opener-Policy: unsafe-none`. A stricter value severs
   `window.opener` and the result can never return to the guest.
5. Open a guest page over the LAN, add `&passkey=1` to its address, and run the
   check in Settings under "Your person key". Do it on a real iPhone and a real
   Android phone. A virtual authenticator does not copy its PRF secret between
   devices, so headless runs cannot stand in for this.
