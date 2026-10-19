/**
 * THROWAWAY PROTOTYPE (TAP-217). Not production code.
 *
 * The two ways a passkey can stand behind a person key.
 *
 * - PRF: the passkey's PRF output derives an AES key. That key wraps an
 *   Ed25519 person key, and the host keeps only the wrapped bytes.
 * - Passkey-as-key: the passkey's own key pair is the person key. It is
 *   usually P-256, so its certificates are WebAuthn assertions.
 */

import {
  exportPublicKey,
  fromBase64Url,
  generateSigningKeyPair,
  signStatement,
  toBase64Url,
  type Signed,
} from './provenance'
import {
  PROTO_CERT_TYPE,
  passkeyChallenge,
  type Ed25519CertPayload,
  type PasskeyAlg,
  type PasskeyCert,
  type PasskeyCertPayload,
} from './certs'

const encoder = new TextEncoder()

/** The same salt every time, so any device gets the same PRF output. */
const PRF_SALT = encoder.encode('tapes/person-key-wrap@0')

const COSE: Record<number, string> = {
  [-7]: 'ES256',
  [-8]: 'EdDSA',
  [-257]: 'RS256',
}

export type HostApi = {
  put(path: string, body: unknown): Promise<unknown>
  get<T>(path: string): Promise<T | undefined>
}

export function rpId(): string {
  const fromQuery = new URLSearchParams(location.search).get('rp')
  return fromQuery || location.hostname
}

function random(bytes: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(bytes))
}

async function createPasskey(
  name: string,
  algs: number[],
  prf: boolean,
): Promise<PublicKeyCredential> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { id: rpId(), name: 'Tapes prototype' },
      user: { id: random(16), name, displayName: name },
      challenge: random(32),
      pubKeyCredParams: algs.map((alg) => ({ type: 'public-key', alg })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      attestation: 'none',
      extensions: prf ? { prf: { eval: { first: PRF_SALT } } } : {},
    },
  })) as PublicKeyCredential | null
  if (!credential) {
    throw new Error('No passkey was created')
  }
  return credential
}

/** A discoverable sign-in. The person picks the passkey. */
async function getPasskey(
  challenge: Uint8Array<ArrayBuffer>,
  prf: boolean,
): Promise<PublicKeyCredential> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      rpId: rpId(),
      challenge,
      userVerification: 'required',
      extensions: prf ? { prf: { eval: { first: PRF_SALT } } } : {},
    },
  })) as PublicKeyCredential | null
  if (!credential) {
    throw new Error('No passkey was chosen')
  }
  return credential
}

function prfOutput(credential: PublicKeyCredential): ArrayBuffer | undefined {
  const first = credential.getClientExtensionResults().prf?.results?.first
  if (!first) {
    return undefined
  }
  return first instanceof ArrayBuffer
    ? first
    : (first.buffer.slice(
        first.byteOffset,
        first.byteOffset + first.byteLength,
      ) as ArrayBuffer)
}

async function wrappingKey(prf: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', prf, 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode('tapes person key wrap'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

type WrappedPerson = { personKey: string; iv: string; wrapped: string }

export type Log = (message: string) => void

// ---------- PRF approach ----------

/**
 * Creates a passkey and a new Ed25519 person key, wraps the person key with
 * the passkey's PRF output, and leaves the wrapped bytes with the host.
 * Returns the unwrapped private key for one immediate certificate.
 */
export async function createPrfPerson(
  name: string,
  host: HostApi,
  log: Log,
): Promise<{ personKey: string; privateKey: CryptoKey }> {
  const created = await createPasskey(name, [-8, -7, -257], true)
  const results = created.getClientExtensionResults().prf
  log(`Passkey created. PRF enabled: ${results?.enabled ?? 'not reported'}.`)

  // Apple and Google can return PRF output at creation. Others need a sign-in.
  let output = prfOutput(created)
  if (!output) {
    log('No PRF output at creation. Asking for a sign-in to get it.')
    output = prfOutput(await getPasskey(random(32), true))
  }
  if (!output) {
    throw new Error(
      'This passkey provider gave no PRF output. The PRF approach cannot work here.',
    )
  }

  const person = await generateSigningKeyPair(true)
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', person.privateKey)
  const iv = random(12)
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await wrappingKey(output),
    pkcs8,
  )
  const personKey = await exportPublicKey(person.publicKey)
  const record: WrappedPerson = {
    personKey,
    iv: toBase64Url(iv),
    wrapped: toBase64Url(new Uint8Array(wrapped)),
  }
  await host.put(`prf-person/${created.id}`, record)
  log('Wrapped person key stored on the host.')
  return { personKey, privateKey: person.privateKey }
}

/** Signs in with the passkey, fetches the wrapped key, and unwraps it. */
export async function unlockPrfPerson(
  host: HostApi,
  log: Log,
): Promise<{ personKey: string; privateKey: CryptoKey }> {
  const credential = await getPasskey(random(32), true)
  const output = prfOutput(credential)
  if (!output) {
    throw new Error('Signed in, but the provider returned no PRF output.')
  }
  const record = await host.get<WrappedPerson>(`prf-person/${credential.id}`)
  if (!record) {
    throw new Error(
      'The host has no wrapped key for this passkey. Was it made with the PRF button?',
    )
  }
  let pkcs8: ArrayBuffer
  try {
    pkcs8 = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(record.iv)! },
      await wrappingKey(output),
      fromBase64Url(record.wrapped)!,
    )
  } catch {
    // Seen in Safari's cross-device flow, where PRF output differed from
    // the same passkey used on the device itself.
    throw new Error('PRF output did not unwrap the key. The PRF value changed.')
  }
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'Ed25519' },
    false,
    ['sign'],
  )
  log('Person key unwrapped in memory.')
  return { personKey: record.personKey, privateKey }
}

export async function certifyWithPersonKey(
  person: { personKey: string; privateKey: CryptoKey },
  deviceKey: string,
): Promise<Signed<Ed25519CertPayload>> {
  return signStatement(
    {
      type: PROTO_CERT_TYPE,
      personKey: person.personKey,
      deviceKey,
      issuedAt: new Date().toISOString(),
    },
    person.privateKey,
  )
}

// ---------- Passkey-as-key approach ----------

type PasskeyPerson = { publicKey: string; alg: PasskeyAlg }

/**
 * Creates a passkey and records its public key with the host. An assertion
 * does not carry the public key, so a new phone has to look it up.
 * Asks for Ed25519 first, to see whether the provider honours it.
 */
export async function createPasskeyPerson(
  name: string,
  host: HostApi,
  log: Log,
  algs: number[] = [-8, -7],
): Promise<PasskeyPerson> {
  const created = await createPasskey(name, algs, false)
  const response = created.response as AuthenticatorAttestationResponse
  const algNumber = response.getPublicKeyAlgorithm()
  const alg = COSE[algNumber] ?? `COSE ${algNumber}`
  log(
    `Passkey created with algorithm ${alg}. Requested: ${algs.map((a) => COSE[a]).join(', ')}.`,
  )
  const spki = response.getPublicKey()
  if (!spki || (alg !== 'ES256' && alg !== 'EdDSA')) {
    throw new Error(`Cannot use a ${alg} passkey as a person key here.`)
  }
  const person: PasskeyPerson = {
    publicKey: toBase64Url(new Uint8Array(spki)),
    alg: alg as PasskeyAlg,
  }
  await host.put(`passkey-person/${created.id}`, person)
  return person
}

/** One passkey prompt. The assertion is the certificate's signature. */
export async function certifyWithPasskey(
  deviceKey: string,
  host: HostApi,
): Promise<PasskeyCert> {
  const payload: PasskeyCertPayload = {
    type: PROTO_CERT_TYPE,
    deviceKey,
    issuedAt: new Date().toISOString(),
    rpId: rpId(),
  }
  const credential = await getPasskey(await passkeyChallenge(payload), false)
  const person = await host.get<PasskeyPerson>(
    `passkey-person/${credential.id}`,
  )
  if (!person) {
    throw new Error(
      'The host does not know this passkey. Was it made with the passkey-as-key button?',
    )
  }
  const response = credential.response as AuthenticatorAssertionResponse
  const b64 = (buffer: ArrayBuffer) => toBase64Url(new Uint8Array(buffer))
  return {
    payload,
    personKey: person.publicKey,
    personKeyAlg: person.alg,
    webauthn: {
      credentialId: credential.id,
      authenticatorData: b64(response.authenticatorData),
      clientDataJSON: b64(response.clientDataJSON),
      signature: b64(response.signature),
    },
  }
}

// ---------- Diagnostics ----------

export async function capabilities(): Promise<Record<string, string>> {
  const out: Record<string, string> = {
    origin: location.origin,
    'rp id': rpId(),
    'secure context': String(isSecureContext),
    webauthn: String(typeof PublicKeyCredential !== 'undefined'),
  }
  if (/^[\d.]+$|:/.test(rpId())) {
    out['rp id'] += ' (an IP address: WebAuthn will refuse it)'
  }
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign'])
    out['WebCrypto Ed25519'] = 'yes'
  } catch {
    out['WebCrypto Ed25519'] = 'no'
  }
  if (typeof PublicKeyCredential === 'undefined') {
    return out
  }
  out['platform authenticator'] = String(
    await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
  )
  if ('getClientCapabilities' in PublicKeyCredential) {
    try {
      const caps = await PublicKeyCredential.getClientCapabilities()
      // A capability flag says the browser knows PRF, not that the provider
      // returns it. Only a real registration tells.
      out['client says PRF'] = String(caps['extension:prf'] ?? 'not listed')
      out['client says related origins'] = String(
        caps.relatedOrigins ?? 'not listed',
      )
    } catch {
      out['client capabilities'] = 'threw'
    }
  } else {
    out['client capabilities'] = 'API missing'
  }
  return out
}
