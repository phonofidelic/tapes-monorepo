/**
 * The passkey ceremony for a Tapes person key, version 1.
 *
 * A guest is served from the host's LAN IP, which WebAuthn refuses as a
 * relying party id. So the guest page opens this page in a new tab, this page
 * runs the passkey, and the result goes back to the opener. Nothing is stored
 * here and nothing is sent anywhere else.
 *
 * This is trusted code for key material. Keep it small, keep it dependency
 * free, and copy it to ceremony.v2.js rather than changing it in place once
 * passkeys are bound to this origin. The message shapes are mirrored in
 * packages/core/app/personKeyCeremony.ts, which cannot import them.
 */

/** Both sides check this before reading any other field. */
const PROTOCOL = 'tapes-person-key-ceremony'
const PROTOCOL_VERSION = 1
const PAGE_VERSION = 'ceremony.v1'

/**
 * The relying party id every Tapes passkey is bound to. It is the registrable
 * domain, not this host name, so another subdomain can serve the page later.
 * It can never change: a passkey made under one id cannot be read under
 * another.
 */
const RELYING_PARTY_ID = 'tapes.network'

/**
 * The one PRF salt, from Person key wrapping format v1. The same salt on every
 * device and every record means one passkey yields one secret.
 */
const PRF_SALT = new TextEncoder().encode('tapes/person-key/v1')

/** WebAuthn's own cap on a credential id. */
const MAX_CREDENTIAL_ID_LENGTH = 1023

const element = {
  asking: /** @type {HTMLElement} */ (document.getElementById('asking')),
  origin: /** @type {HTMLElement} */ (document.getElementById('origin')),
  hostName: /** @type {HTMLElement} */ (document.getElementById('host-name')),
  actionNote: /** @type {HTMLElement} */ (
    document.getElementById('action-note')
  ),
  confirm: /** @type {HTMLButtonElement} */ (
    document.getElementById('confirm')
  ),
  cancel: /** @type {HTMLButtonElement} */ (document.getElementById('cancel')),
  close: /** @type {HTMLButtonElement} */ (document.getElementById('close')),
  status: /** @type {HTMLElement} */ (document.getElementById('status')),
  pageVersion: /** @type {HTMLElement} */ (
    document.getElementById('page-version')
  ),
}

/**
 * @typedef {object} CeremonyRequest
 * @property {string} nonce
 * @property {'create' | 'get'} action
 * @property {string} hostName
 * @property {string} [personName]
 * @property {string} [userId]
 * @property {string[]} [credentialIds]
 */

/** One request per page load, so a confirmed tap cannot be reused. */
let answered = false

/** Set once a request arrives from the opener's verified origin. */
let pending = /** @type {{ origin: string; request: CeremonyRequest } | null} */ (
  null
)

element.pageVersion.textContent = `Page ${PAGE_VERSION}, protocol ${PROTOCOL_VERSION}. Relying party ${RELYING_PARTY_ID}.`
element.close.addEventListener('click', () => window.close())

start()

function start() {
  const rpId = relyingPartyId()
  if (!rpId) {
    return stop(
      `This page only works on ${RELYING_PARTY_ID}. Nothing was asked of your passkey.`,
    )
  }
  if (!window.opener) {
    return stop(
      'Open this page from Tapes. It has nothing to do on its own, and it cannot reach your recordings.',
    )
  }
  const origin = openerOrigin()
  if (!origin) {
    return stop('Tapes did not say where this request came from. Nothing happened.')
  }
  window.addEventListener('message', (event) => received(event, origin))
  // The opener cannot know when this page is ready, so this page speaks first.
  // The exact target origin means a page that lied about its own address gets
  // nothing: the browser drops the message instead of delivering it.
  window.opener.postMessage(
    { tapes: PROTOCOL, version: PROTOCOL_VERSION, type: 'ready' },
    origin,
  )
}

/**
 * The relying party id for this host, or null when the page is served
 * somewhere it has no business binding passkeys. Localhost is allowed so the
 * page can be run from a dev server.
 */
function relyingPartyId() {
  const host = window.location.hostname
  if (host === RELYING_PARTY_ID || host.endsWith(`.${RELYING_PARTY_ID}`)) {
    return RELYING_PARTY_ID
  }
  return host === 'localhost' || host.endsWith('.localhost') ? host : null
}

/**
 * The origin the opener claims, from the fragment. A fragment is never sent to
 * this server and stays out of the referrer. The claim is only used as the
 * postMessage target until a message from it arrives, which is what proves it.
 */
function openerOrigin() {
  const claimed = new URLSearchParams(window.location.hash.slice(1)).get('o')
  if (!claimed) {
    return null
  }
  let url
  try {
    url = new URL(claimed)
  } catch {
    return null
  }
  if (url.origin !== claimed) {
    return null
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  return url.protocol === 'https:' || (url.protocol === 'http:' && local)
    ? url.origin
    : null
}

/**
 * @param {MessageEvent} event
 * @param {string} origin
 */
function received(event, origin) {
  // The claimed origin is checked against the real one here. Everything after
  // this point is shown to the person as coming from an address they can read.
  if (event.source !== window.opener || event.origin !== origin) {
    return
  }
  const request = asRequest(event.data)
  if (!request || pending || answered) {
    return
  }
  pending = { origin, request }
  ask(origin, request)
}

/**
 * @param {string} origin
 * @param {CeremonyRequest} request
 */
function ask(origin, request) {
  element.origin.textContent = origin
  element.hostName.textContent = request.hostName
  element.actionNote.textContent =
    request.action === 'create'
      ? 'Continuing makes a new passkey on this device.'
      : 'Continuing unlocks your person key with a passkey you already have.'
  element.asking.hidden = false
  element.status.textContent = ''
  element.confirm.addEventListener('click', run, { once: true })
  element.cancel.addEventListener('click', () => reject('declined'), {
    once: true,
  })
  element.confirm.focus()
}

async function run() {
  if (!pending || answered) {
    return
  }
  const { request } = pending
  answered = true
  element.asking.hidden = true
  element.status.textContent = 'Follow your device’s prompt.'
  const rpId = relyingPartyId()
  if (!rpId || !window.PublicKeyCredential) {
    return reject('unsupported')
  }
  try {
    const outcome =
      request.action === 'create'
        ? await createPasskey(rpId, request)
        : await usePasskey(rpId, request.credentialIds)
    if (!outcome.prf) {
      // Some password managers answer the ceremony but return no PRF output.
      // The passphrase backup is the way through for those people.
      return reject('no-prf')
    }
    resolve(rpId, outcome.credentialId, outcome.prf)
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    reject(name === 'NotAllowedError' ? 'declined' : 'failed')
  }
}

/**
 * @param {string} rpId
 * @param {CeremonyRequest} request
 */
async function createPasskey(rpId, request) {
  const name = request.personName?.trim() || 'Tapes person'
  const credential = /** @type {PublicKeyCredential} */ (
    await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { id: rpId, name: 'Tapes' },
        user: {
          // The person public key, when the opener sent it, so one person has
          // one passkey rather than a new one per device.
          id: decodeUserId(request.userId) ?? crypto.getRandomValues(new Uint8Array(32)),
          name,
          displayName: name,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        // Discoverable, because a new phone has no credential id to offer.
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
        extensions: prfExtension(),
      },
    })
  )
  const credentialId = toBase64Url(new Uint8Array(credential.rawId))
  const prf = prfOutput(credential)
  if (prf) {
    return { credentialId, prf }
  }
  // iCloud Keychain and Google Password Manager often report PRF as enabled
  // but return no output until the passkey is used. A second prompt follows.
  element.status.textContent = 'Use the same passkey once more to finish.'
  return usePasskey(rpId, [credentialId])
}

/**
 * @param {string} rpId
 * @param {string[] | undefined} credentialIds
 */
async function usePasskey(rpId, credentialIds) {
  const allow = (credentialIds ?? [])
    .map(decodeCredentialId)
    .filter((id) => id !== null)
  const assertion = /** @type {PublicKeyCredential} */ (
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId,
        userVerification: 'required',
        // An empty list means any Tapes passkey on this device, which is what
        // a replacement phone has to ask for.
        allowCredentials: allow.map((id) => ({ type: 'public-key', id })),
        extensions: prfExtension(),
      },
    })
  )
  return {
    credentialId: toBase64Url(new Uint8Array(assertion.rawId)),
    prf: prfOutput(assertion),
  }
}

/**
 * The PRF extension input. TypeScript's DOM types do not carry it yet, so the
 * shape is asserted here in one place rather than at each call.
 */
function prfExtension() {
  return /** @type {AuthenticationExtensionsClientInputs} */ ({
    prf: { eval: { first: PRF_SALT } },
  })
}

/**
 * The 32 bytes the passkey derived, or undefined when it returned none.
 *
 * @param {PublicKeyCredential} credential
 */
function prfOutput(credential) {
  const results = /** @type {{ prf?: { results?: { first?: ArrayBuffer } } }} */ (
    credential.getClientExtensionResults()
  )
  const first = results.prf?.results?.first
  return first ? new Uint8Array(first) : undefined
}

/**
 * @param {string} rpId
 * @param {string} credentialId
 * @param {Uint8Array} prf
 */
function resolve(rpId, credentialId, prf) {
  const encoded = toBase64Url(prf)
  prf.fill(0)
  post({ type: 'result', rpId, credentialId, prf: encoded })
  element.status.textContent = 'Done. Tapes has what it needs.'
  element.close.hidden = false
}

/**
 * @param {'declined' | 'unsupported' | 'no-prf' | 'failed'} reason
 */
function reject(reason) {
  answered = true
  element.asking.hidden = true
  post({ type: 'error', reason })
  element.status.textContent = message(reason)
  element.close.hidden = false
}

/** @param {Record<string, unknown>} payload */
function post(payload) {
  if (!pending) {
    return
  }
  window.opener?.postMessage(
    {
      tapes: PROTOCOL,
      version: PROTOCOL_VERSION,
      nonce: pending.request.nonce,
      ...payload,
    },
    pending.origin,
  )
}

/** @param {string} reason */
function message(reason) {
  if (reason === 'declined') {
    return 'Cancelled. Nothing was shared.'
  }
  if (reason === 'no-prf') {
    return 'This passkey cannot hold a key for Tapes. Use your passphrase backup instead.'
  }
  if (reason === 'unsupported') {
    return 'This browser cannot make a passkey. Use your passphrase backup instead.'
  }
  return 'That did not work. You can close this tab and try again.'
}

/**
 * Shown when the page cannot run at all. No message goes to the opener.
 *
 * @param {string} text
 */
function stop(text) {
  element.status.textContent = text
}

/**
 * The request, or null for anything this version cannot read. Never throws:
 * the value comes from another origin.
 *
 * @param {unknown} value
 * @returns {CeremonyRequest | null}
 */
function asRequest(value) {
  const data = /** @type {Record<string, unknown>} */ (
    typeof value === 'object' && value !== null ? value : {}
  )
  if (data.tapes !== PROTOCOL || data.version !== PROTOCOL_VERSION) {
    return null
  }
  if (data.type !== 'request') {
    return null
  }
  const { nonce, hostName, personName, userId, credentialIds } = data
  if (typeof nonce !== 'string' || !nonce) {
    return null
  }
  const action =
    data.action === 'create' || data.action === 'get' ? data.action : null
  if (!action) {
    return null
  }
  const ids = Array.isArray(credentialIds)
    ? credentialIds.filter((id) => typeof id === 'string')
    : []
  return {
    nonce,
    action,
    hostName: label(hostName),
    personName: typeof personName === 'string' ? personName.slice(0, 64) : undefined,
    userId: typeof userId === 'string' ? userId : undefined,
    credentialIds: ids,
  }
}

/**
 * The host's own name for itself, which nothing here can verify. It is shown
 * next to the origin, which is what the person should judge. Control
 * characters are dropped so a name cannot forge its way out of its line.
 *
 * @param {unknown} value
 */
function label(value) {
  const text =
    typeof value === 'string'
      // eslint-disable-next-line no-control-regex
      ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()
      : ''
  return text ? text.slice(0, 64) : 'a Tapes host'
}

/** @param {string | undefined} text */
function decodeUserId(text) {
  const bytes = text ? fromBase64Url(text) : undefined
  // WebAuthn caps a user handle at 64 bytes and refuses an empty one.
  return bytes && bytes.length > 0 && bytes.length <= 64 ? bytes : undefined
}

/** @param {string} text */
function decodeCredentialId(text) {
  const bytes = fromBase64Url(text)
  return bytes && bytes.length > 0 && bytes.length <= MAX_CREDENTIAL_ID_LENGTH
    ? bytes
    : null
}

/** @param {Uint8Array} bytes */
function toBase64Url(bytes) {
  let text = ''
  for (const byte of bytes) {
    text += String.fromCharCode(byte)
  }
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/**
 * Unpadded base64url, or undefined for anything else. The input comes from
 * another origin, so it never throws.
 *
 * @param {string} text
 */
function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    return undefined
  }
  const padded = text.replaceAll('-', '+').replaceAll('_', '/')
  try {
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return undefined
  }
}
