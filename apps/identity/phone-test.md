# Testing the passkey handoff on a phone

The handoff cannot be tested without real phones. A virtual authenticator does
not copy its PRF secret between devices, and the password managers differ in
whether they return PRF output at creation. Run this on an iPhone with iCloud
Keychain and an Android phone with Google Password Manager.

Nothing here wraps or stores a key. The check reports what the passkey page
answered, and a short hash of the PRF output so two phones can be compared.

## Before you start

- [ ] The desktop host is running and serving the web client over HTTPS on the
      LAN (`yarn dev:https`, or a release build).
- [ ] The host has a name set in Settings, under "This host's name". Note it
      down. The check shows it, so an empty one proves nothing.
- [ ] Both phones are on the same network as the host.
- [ ] `https://identity.tapes.network` opens in a phone browser.

## On each phone

- [ ] Scan the host's QR code and join. A link from before this change carries
      no host name, so scan a fresh one.
- [ ] Install the host's root certificate if the browser asks.
- [ ] Add `&passkey=1` to the address and reload.
- [ ] Open Settings. "Passkey page" is under "Your person key".

### Make a passkey

- [ ] Tap "Make a passkey". A new tab opens at `identity.tapes.network`.
      Note whether the browser opens a tab, a window or nothing.
- [ ] The page shows the host's LAN address as the origin that is asking.
      Check the port matches the one in the address bar of the guest page.
- [ ] The page shows the host's name from Settings, not a LAN address.
- [ ] Tap "Continue". Pass Face ID, Touch ID or the fingerprint reader.
- [ ] Note whether it prompts once or twice. A second prompt means the password
      manager returned no PRF output at creation, which is expected on some.
- [ ] The guest page says a passkey answered for `tapes.network`, with a
      credential and a PRF value. Write the PRF value down.
- [ ] Note the time from the first tap to that line.

### Use the passkey again

- [ ] Tap "Use a passkey" on the same phone. Pass the prompt.
- [ ] The PRF value is the same as the one you wrote down. A different value
      means the secret is not stable, and nothing can be unlocked with it.

### The same passkey on the other phone

Only once both phones are signed into the same iCloud or Google account, and
the passkey has synced.

- [ ] Tap "Use a passkey" on the second phone, without making a new one.
- [ ] The passkey from the first phone is offered.
- [ ] The PRF value matches the first phone's. This is the one result the
      headless runs could not stand in for.

## Failure cases

Each of these should say what happened and leave everything else working.

- [ ] Tap "Cancel" on the passkey page. The page says nothing was shared, and
      the guest page says it was cancelled.
- [ ] Tap "Continue", then dismiss the Face ID prompt. Same result.
- [ ] Turn on the browser's pop-up blocking and run the check. The guest page
      says the new tab was blocked.
- [ ] Open `https://identity.tapes.network` directly, with no Tapes tab open.
      The page explains itself and asks nothing of any passkey.
- [ ] With a password manager that returns no PRF output, the guest page says
      so. The passphrase backup is the path for that person.
- [ ] Turn off the phone's internet, leaving it on the LAN. Recording, syncing
      and the host vouch all still work. Only the passkey check fails.

## What to record

Write the results on the ticket: the phone, the browser, the password manager,
whether PRF came back at creation or needed a second prompt, the time from tap
to answer, and anything a person had to be told to get through it.
