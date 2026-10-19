/**
 * THROWAWAY PROTOTYPE (TAP-217). Not production code.
 *
 * The guest page a phone opens. It holds a device key, gets it certified by a
 * passkey-backed person key, and signs fake recordings the host checks.
 * Plain DOM so the page stays one small file.
 */

import {
  exportPublicKey,
  NO_SESSION_ID,
  RECORDING_CLAIM_TYPE,
  sha256Hex,
  signStatement,
  statementAddress,
  type RecordingClaim,
} from './provenance'
import { fingerprint, isPasskeyCert, type AnyCert } from './certs'
import { loadDevice, saveDevice, wipeDevice } from './deviceStore'
import {
  capabilities,
  certifyWithPasskey,
  certifyWithPersonKey,
  createPasskeyPerson,
  createPrfPerson,
  unlockPrfPerson,
  type HostApi,
} from './passkeys'

const loadedAt = performance.now()

const host: HostApi = {
  async put(path, body) {
    const response = await fetch(`/proto-api/store/${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(`Host refused: ${response.status}`)
    }
    return response.json()
  },
  async get<T>(path: string) {
    const response = await fetch(`/proto-api/store/${path}`)
    return response.ok ? ((await response.json()) as T) : undefined
  },
}

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T

function log(message: string) {
  const line = document.createElement('li')
  const seconds = ((performance.now() - loadedAt) / 1000).toFixed(1)
  line.textContent = `[${seconds}s] ${message}`
  $('log').prepend(line)
}

function fail(error: unknown) {
  const text =
    error instanceof DOMException
      ? `${error.name}: ${error.message}`
      : String(error instanceof Error ? error.message : error)
  log(`ERROR ${text}`)
}

/** Runs one button's action, logging how long it took from tap to done. */
function action(id: string, run: () => Promise<void>) {
  $<HTMLButtonElement>(id).addEventListener('click', async () => {
    const started = performance.now()
    document.querySelectorAll('button').forEach((b) => (b.disabled = true))
    try {
      await run()
      log(`(${id} took ${((performance.now() - started) / 1000).toFixed(1)}s)`)
    } catch (error) {
      fail(error)
    } finally {
      document.querySelectorAll('button').forEach((b) => (b.disabled = false))
      await render()
    }
  })
}

let device: Awaited<ReturnType<typeof loadDevice>>

async function deviceKey() {
  return exportPublicKey(device.keyPair.publicKey)
}

async function storeCert(cert: AnyCert) {
  const result = (await host.put('cert', cert)) as {
    ok: boolean
    reason?: string
    address?: string
  }
  if (!result.ok) {
    throw new Error(`Host rejected the certificate: ${result.reason}`)
  }
  device.cert = cert
  device.certAddress = result.address
  await saveDevice(device)
  const how = isPasskeyCert(cert)
    ? `passkey-as-key (${cert.personKeyAlg})`
    : 'PRF-unwrapped Ed25519'
  const person = isPasskeyCert(cert) ? cert.personKey : cert.payload.personKey
  log(`Device certified via ${how}. Person ${await fingerprint(person)}.`)
}

function personName(): string {
  return $<HTMLInputElement>('name').value.trim() || 'Tapes tester'
}

async function render() {
  const key = await deviceKey()
  $('device').textContent = await fingerprint(key)
  if (device.cert) {
    const person = isPasskeyCert(device.cert)
      ? device.cert.personKey
      : device.cert.payload.personKey
    $('person').textContent =
      `${await fingerprint(person)} (${isPasskeyCert(device.cert) ? 'passkey-as-key' : 'PRF'})`
    $('status').textContent =
      'Certified. Recordings will be linked to the person.'
    $('status').className = 'ok'
  } else {
    $('person').textContent = 'none'
    $('status').textContent = device.fresh
      ? 'New device key. Not linked to a person yet. Set up or recover below.'
      : 'Device key has no certificate yet.'
    $('status').className = 'warn'
  }
}

async function main() {
  device = await loadDevice()
  log(
    device.fresh
      ? 'Empty store on this origin. Made a new device key.'
      : 'Found this origin’s device key.',
  )

  const caps = await capabilities()
  $('caps').innerHTML = Object.entries(caps)
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('')

  action('setup-prf', async () => {
    const person = await createPrfPerson(personName(), host, log)
    await storeCert(await certifyWithPersonKey(person, await deviceKey()))
  })
  action('setup-passkey', async () => {
    // ?alg=es256 asks for P-256 only. By default Ed25519 is asked for first,
    // to see whether the provider honours it.
    const es256Only =
      new URLSearchParams(location.search).get('alg') === 'es256'
    const person = await createPasskeyPerson(
      personName(),
      host,
      log,
      es256Only ? [-7] : [-8, -7],
    )
    log('Now sign once with the passkey to certify this device.')
    await storeCert(await certifyWithPasskey(await deviceKey(), host))
    log(`Person key algorithm: ${person.alg}.`)
  })
  action('recover-prf', async () => {
    const person = await unlockPrfPerson(host, log)
    await storeCert(await certifyWithPersonKey(person, await deviceKey()))
  })
  action('recover-passkey', async () => {
    await storeCert(await certifyWithPasskey(await deviceKey(), host))
  })
  action('record', async () => {
    // A fake recording: random bytes stand in for audio.
    const bytes = crypto.getRandomValues(new Uint8Array(2048))
    const now = new Date().toISOString()
    // The real claim type already has a slot for the certificate's address.
    const signed = await signStatement<RecordingClaim>(
      {
        type: RECORDING_CLAIM_TYPE,
        blob: {
          hash: await sha256Hex(bytes),
          size: bytes.length,
          mimeType: 'audio/webm',
        },
        startedAt: now,
        endedAt: now,
        sessionId: NO_SESSION_ID,
        deviceKey: await deviceKey(),
        deviceCert: device.certAddress,
      },
      device.keyPair.privateKey,
    )
    const result = (await (
      await fetch('/proto-api/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signed),
      })
    ).json()) as { verdict: string }
    log(
      `Recording ${(await statementAddress(signed)).slice(0, 8)} signed. Host says: ${result.verdict}`,
    )
  })
  action('wipe', async () => {
    await wipeDevice()
    log('Wiped this origin’s store. Reloading as if the host IP changed.')
    setTimeout(() => location.reload(), 600)
  })

  await render()
}

main().catch(fail)
