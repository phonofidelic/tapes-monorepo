# identity

The passkey ceremony page, served at `https://identity.tapes.network`. It is
the only part of Tapes with a domain name.

A guest loads Tapes from the host's LAN IP, and WebAuthn refuses an IP address
as a relying party id. So the guest page opens this page in a new tab. This
page runs the passkey and sends the result back to the opener.

Recording, syncing and the host vouch never load it. With this domain
unreachable, everything except passkey recovery works as before. The passphrase
backup still restores a person key on its own.

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
subdomain could serve this page later without invalidating a single passkey.
The relying party id can never change. Losing the domain means passkeys stop
unlocking, which is why the passphrase backup stays an equal path.

The page itself runs only on `identity.tapes.network`. The two are deliberately
different. WebAuthn lets every subdomain of a registrable domain use it as a
relying party id. Naming one host here means this file does nothing if it is
served anywhere else under the domain. Moving the page is a one-line change
made on purpose.

A dev server on `localhost` is the exception. There the page uses its own host
name as the id.

## The message protocol

Version 1. The guest side mirrors these shapes, in
`packages/core/app/personKeyCeremony.ts`, because it cannot import them.

1. The guest opens this page in a new tab, on a tap, with its own origin in the
   fragment. A fragment is not sent to the server and stays out of the referrer.
2. The page posts `{ type: 'ready' }` to that exact origin. A page that lied
   about its address gets nothing, because the browser drops the message.
3. The guest replies with `{ type: 'request', nonce, action, hostName, … }`.
   The page checks that the message came from the origin in the fragment.
4. The page shows that origin and the host's claimed name. It waits for a tap.
5. The page runs the passkey with the PRF extension. It posts back
   `{ type: 'result', credentialId, rpId, prf }` or `{ type: 'error', reason }`.

The host's name arrives as `hn` on the pairing link, so it is the host's own
name for itself. Nothing verifies it. That is why the origin is shown next to
it.

The PRF salt is `tapes/person-key/v1`, from Person key wrapping format v1. The
page derives nothing and wraps nothing. It hands back the PRF output. The guest
does the HKDF and AES-GCM work with the person key it already holds.

The page keeps no state of its own. One request per page load, so a confirmed
tap cannot be reused.

## Who can change what is served

This is trusted code for key material. Anything served from this origin can ask
a person to unlock their person key behind a Face ID prompt. The repository is
public, so the write path to the origin matters more than the code being
readable.

- **The page has no dependencies and no build step.** An automerged dependency
  update therefore cannot change what this origin serves.
- **A code owners file covers this directory.** It has no effect unless branch
  protection on `main` requires those reviews.
- **Preview deployments stay off the custom domain.** A preview on a
  `tapes.network` name can use the relying party id.
- **Keep the zone near empty and free of stale CNAMEs.** A subdomain someone
  else takes over can create and use Tapes passkeys.

## Changing it

- Keep it small and dependency free.
- Add `ceremony.v2.js` beside the version 1 file rather than editing version 1,
  once real passkeys are bound to this origin. Old guests keep working.
- `yarn workspace identity check-types` type-checks the page.
- `yarn dev` serves the page on port 3003.

## Serving it

The page is live from a Cloudflare Pages project with no build command.
`apps/identity/public` is its output directory. The headers in `public/_headers`
are applied, including `Cross-Origin-Opener-Policy: unsafe-none`.

That header is the one to re-check after any change to the project. A stricter
value severs `window.opener`. The result can then never return to the guest.

Set up by hand, outside this repo, and worth knowing if the domain ever moves:

- **Registrar lock and DNSSEC go on first**, with a long registration. Whoever
  holds `tapes.network` controls every passkey bound to it.
- Cloudflare issues and renews the certificate for the custom domain.

## Testing the handoff on a phone

Open a guest page over the LAN, add `&passkey=1` to its address, and run the
check in Settings under "Your person key". It makes a passkey, or uses one that
exists. It then shows a short hash of the PRF output, so two phones can be
compared.

Do it on a real iPhone with iCloud Keychain and a real Android phone with
Google Password Manager. A virtual authenticator does not copy its PRF secret
between devices, so headless runs cannot stand in for this.
