// THROWAWAY PROTOTYPE (TAP-220). Not production code.
//
// The client page: make a person key, back it up under a passkey, and restore
// it on another device. Everything secret happens here, in the browser.
// The relying party id is this page's host name, so it must be a real domain
// (or localhost). An IP address does not work.

import {
  PRF_SALT,
  deriveKeys,
  fingerprint,
  fromBase64Url,
  toBase64Url,
  unwrapPersonKey,
  wrapPersonKey,
} from './wrap.js'

const $ = (id) => document.getElementById(id)
const log = (text) => {
  const line = `${new Date().toLocaleTimeString()}  ${text}`
  $('log').textContent = `${line}\n${$('log').textContent}`
}

/** Holds the person key in memory only. A reload forgets it on purpose. */
let personKey

async function publicFingerprint(keyPair) {
  const raw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  return fingerprint(new Uint8Array(raw))
}

function showKey(label) {
  $('current-key').textContent = label ?? 'none on this device'
}

/** Asks the passkey for its PRF output. Returns undefined when unsupported. */
async function prfFromAssertion(credentialId) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      userVerification: 'required',
      // No list means "any passkey for this site". That is what a new phone needs.
      allowCredentials: credentialId
        ? [{ type: 'public-key', id: fromBase64Url(credentialId) }]
        : [],
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  })
  const first = assertion.getClientExtensionResults().prf?.results?.first
  return {
    credentialId: toBase64Url(new Uint8Array(assertion.rawId)),
    prf: first ? new Uint8Array(first) : undefined,
  }
}

async function createPasskey() {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { id: location.hostname, name: 'Tapes recovery (prototype)' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: $('name').value || 'tapes-person',
        displayName: $('name').value || 'Tapes person',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  })
  const prf = credential.getClientExtensionResults().prf
  const credentialId = toBase64Url(new Uint8Array(credential.rawId))
  log(`Passkey created. PRF enabled: ${prf?.enabled ?? 'not reported'}`)
  // iCloud Keychain and Google Password Manager can return the output at
  // creation. Others need a second prompt.
  if (prf?.results?.first) {
    return { credentialId, prf: new Uint8Array(prf.results.first) }
  }
  if (prf && prf.enabled === false) return { credentialId, prf: undefined }
  log('Asking the passkey again to get its PRF output.')
  return prfFromAssertion(credentialId)
}

async function api(method, credentialId, authToken, body) {
  const res = await fetch(`/v1/backups/${credentialId}`, {
    method,
    headers: {
      authorization: `Bearer ${authToken}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return {
    status: res.status,
    json: res.status === 204 ? null : await res.json().catch(() => null),
  }
}

$('make-key').addEventListener('click', async () => {
  personKey = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])
  const label = await publicFingerprint(personKey)
  showKey(label)
  log(`Made a new person key ${label}. Write this label down to compare later.`)
})

$('back-up').addEventListener('click', async () => {
  try {
    if (!personKey) return log('Make a person key first.')
    const { credentialId, prf } = await createPasskey()
    if (!prf) {
      return log(
        'This passkey provider gave no PRF output. Backup is not possible with it. Use the passphrase backup instead.',
      )
    }
    const { wrapKey, authToken } = await deriveKeys(prf)
    const pkcs8 = new Uint8Array(
      await crypto.subtle.exportKey('pkcs8', personKey.privateKey),
    )
    const blob = await wrapPersonKey(wrapKey, credentialId, pkcs8)
    const { status } = await api('PUT', credentialId, authToken, { blob })
    log(`Uploaded the encrypted backup. Server answered ${status}.`)
  } catch (error) {
    log(`Backup failed: ${error.name}: ${error.message}`)
  }
})

$('restore').addEventListener('click', async () => {
  const started = performance.now()
  try {
    const { credentialId, prf } = await prfFromAssertion()
    if (!prf) return log('The passkey gave no PRF output. Cannot restore.')
    const { wrapKey, authToken } = await deriveKeys(prf)
    const { status, json } = await api('GET', credentialId, authToken)
    if (status !== 200) return log(`No backup for this passkey (${status}).`)
    const pkcs8 = await unwrapPersonKey(wrapKey, credentialId, json.blob)
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'Ed25519' },
      true,
      ['sign'],
    )
    // Rebuild the public key from the private JWK so the label can be compared.
    const jwk = await crypto.subtle.exportKey('jwk', privateKey)
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
      { name: 'Ed25519' },
      true,
      ['verify'],
    )
    personKey = { privateKey, publicKey }
    const label = await publicFingerprint(personKey)
    showKey(label)
    const seconds = ((performance.now() - started) / 1000).toFixed(1)
    log(
      `Restored person key ${label} in ${seconds}s. Compare it with the label you wrote down.`,
    )
  } catch (error) {
    log(`Restore failed: ${error.name}: ${error.message}`)
  }
})

$('forget').addEventListener('click', () => {
  personKey = undefined
  showKey()
  log('Forgot the person key on this device. Restore to get it back.')
})

if (!window.PublicKeyCredential) {
  log('This browser has no WebAuthn. Passkeys will not work here.')
}
log(`Relying party id: ${location.hostname}`)
