/**
 * THROWAWAY PROTOTYPE (TAP-219). Not production code.
 *
 * The guest page. It keeps a device key, a vouch and (after first enrollment)
 * the person key in IndexedDB on this origin, like the real guest does. When
 * the origin changes the store is empty, and the person picks their name to
 * ask the host for a vouch. The person key does not come back: that is the
 * point of the scenario, and the job of the passkey or backup prototypes.
 */

import {
  exportPublicKey,
  generateSigningKeyPair,
  keyFingerprint,
  type Signed,
} from '@tapes-monorepo/provenance'
import {
  checkDeviceVouch,
  createPersonCertificate,
  createVouchRequest,
  type DeviceVouch,
} from '../lib/statements'

// ---------------------------------------------------------------------------
// IndexedDB. CryptoKey objects store as-is, and a non-extractable private key
// stays non-extractable.

type Stored = {
  deviceKeyPair?: CryptoKeyPair
  personKeyPair?: CryptoKeyPair
  personName?: string
  vouch?: Signed<DeviceVouch>
  requestId?: string
  startedAt?: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('tapes-vouch-prototype', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('kv')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
}

async function load(): Promise<Stored> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const get = db.transaction('kv').objectStore('kv').get('state')
    get.onsuccess = () => resolve((get.result as Stored | undefined) ?? {})
    get.onerror = () => reject(get.error)
  })
}

async function save(stored: Stored): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(stored, 'state')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ---------------------------------------------------------------------------

const app = document.getElementById('app')!
const hostKey = new URLSearchParams(location.search).get('hk') ?? ''
const pageLoadedAt = Date.now()

function deviceLabel(): string {
  const ua = navigator.userAgent
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac/.test(ua)
          ? 'Mac'
          : 'Device'
  const browser = /CriOS|Chrome/.test(ua)
    ? 'Chrome'
    : /FxiOS|Firefox/.test(ua)
      ? 'Firefox'
      : /Safari/.test(ua)
        ? 'Safari'
        : 'Browser'
  return `${device} · ${browser}`
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return (await response.json()) as T
}

function render(html: string) {
  app.innerHTML = html
}

function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  )
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

async function ensureDeviceKey(stored: Stored): Promise<CryptoKeyPair> {
  stored.deviceKeyPair ??= await generateSigningKeyPair()
  await save(stored)
  return stored.deviceKeyPair
}

// ---------------------------------------------------------------------------
// Screens.

async function showVouched(stored: Stored) {
  const vouch = stored.vouch!
  const check = await checkDeviceVouch(vouch, [hostKey])
  const device = await keyFingerprint(vouch.payload.deviceKey)
  const elapsed = stored.startedAt
    ? seconds(Date.parse(vouch.payload.vouchedAt) - stored.startedAt)
    : '?'
  render(`
    <div class="card ok">
      <h1>You're in as ${escapeHtml(vouch.payload.personName)}</h1>
      <p>The host vouched for this phone ${
        vouch.payload.method === 'pin'
          ? 'after your PIN'
          : 'after the operator confirmed'
      }.</p>
      <p class="muted">Took ${elapsed} from the moment you picked your name.</p>
    </div>
    <details><summary>Details</summary>
      <p>Vouch signature against the host key from the QR: <b>${
        check.ok ? 'valid' : check.problem
      }</b></p>
      <p>Device key: <code>${device}</code></p>
      <p>Person key on this phone: <b>${stored.personKeyPair ? 'yes' : 'no'}</b></p>
      <pre>${escapeHtml(JSON.stringify(vouch, null, 2))}</pre>
    </details>
    <button class="secondary" id="forget">Forget this phone (test again)</button>
  `)
  document.getElementById('forget')!.onclick = async () => {
    await save({})
    location.reload()
  }
}

async function showWaiting(stored: Stored) {
  const person = stored.personName ?? 'you'
  render(`
    <div class="card">
      <h1>Hi ${escapeHtml(person)}</h1>
      <p>Ask the person at the host to confirm this phone.</p>
      <p class="muted" id="status">Waiting… <span id="elapsed"></span></p>
    </div>
    <form id="pin-form" class="card">
      <p>Or type your PIN</p>
      <input id="pin" inputmode="numeric" autocomplete="off" pattern="[0-9]*" maxlength="6" placeholder="PIN">
      <button>Use PIN</button>
      <p class="error" id="pin-error"></p>
    </form>
    <button class="secondary" id="cancel">That's not me</button>
  `)
  const elapsed = document.getElementById('elapsed')!
  const timer = setInterval(() => {
    if (stored.startedAt)
      elapsed.textContent = seconds(Date.now() - stored.startedAt)
  }, 200)

  document.getElementById('cancel')!.onclick = async () => {
    clearInterval(timer)
    stored.requestId = undefined
    stored.personName = undefined
    await save(stored)
    void start()
  }

  document.getElementById('pin-form')!.onsubmit = async (event) => {
    event.preventDefault()
    const pin = (document.getElementById('pin') as HTMLInputElement).value
    const result = await api<{
      ok: boolean
      error?: string
      attemptsLeft?: number
      vouch?: Signed<DeviceVouch>
    }>(`/api/requests/${stored.requestId}/pin`, { pin })
    const error = document.getElementById('pin-error')!
    if (result.ok) return
    error.textContent =
      result.error === 'wrong-pin'
        ? `Wrong PIN. ${result.attemptsLeft} tries left.`
        : result.error === 'locked'
          ? 'Too many wrong PINs. Ask the person at the host.'
          : result.error === 'no-pin'
            ? 'You have no PIN set. Ask the person at the host.'
            : 'Something went wrong.'
  }

  // Poll rather than hold a socket: simpler, and a second is fast enough.
  while (stored.requestId) {
    const entry = await api<{
      status?: string
      vouch?: Signed<DeviceVouch>
      error?: string
    }>(`/api/requests/${stored.requestId}`)
    if (entry.status === 'vouched' && entry.vouch) {
      const check = await checkDeviceVouch(entry.vouch, [hostKey])
      if (!check.ok) {
        document.getElementById('status')!.textContent =
          `The host's answer did not verify (${check.problem}). Do not trust this host.`
        break
      }
      clearInterval(timer)
      stored.vouch = entry.vouch
      stored.requestId = undefined
      await save(stored)
      return showVouched(stored)
    }
    if (entry.status === 'rejected' || entry.error === 'not-found') {
      clearInterval(timer)
      stored.requestId = undefined
      await save(stored)
      render(`<div class="card"><h1>Not confirmed</h1>
        <p>The host did not confirm this phone.</p></div>
        <button id="again">Try again</button>`)
      document.getElementById('again')!.onclick = () => start()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

async function pickPerson(stored: Stored, personKey: string, name: string) {
  const deviceKeyPair = await ensureDeviceKey(stored)
  stored.startedAt = Date.now()
  const request = await createVouchRequest(
    { personKey, deviceLabel: deviceLabel(), requestedAt: new Date() },
    deviceKeyPair,
  )
  const result = await api<{ ok: boolean; id?: string; error?: string }>(
    '/api/requests',
    request,
  )
  if (!result.ok || !result.id) {
    render(
      `<div class="card"><p class="error">Could not ask the host: ${escapeHtml(
        result.error ?? 'unknown',
      )}</p></div>`,
    )
    return
  }
  stored.requestId = result.id
  stored.personName = name
  await save(stored)
  return showWaiting(stored)
}

async function showEnroll(stored: Stored) {
  render(`
    <form id="enroll" class="card">
      <h1>New here</h1>
      <label>Your name<input id="name" maxlength="40" autocomplete="off" required></label>
      <label>PIN (optional, 4 to 6 digits)<input id="pin" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" autocomplete="off"></label>
      <p class="muted">A PIN lets you get back in without the person at the host.</p>
      <button>Join</button>
      <p class="error" id="error"></p>
    </form>
    <button class="secondary" id="back">Back</button>
  `)
  document.getElementById('back')!.onclick = () => start()
  document.getElementById('enroll')!.onsubmit = async (event) => {
    event.preventDefault()
    const name = (
      document.getElementById('name') as HTMLInputElement
    ).value.trim()
    const pin = (document.getElementById('pin') as HTMLInputElement).value
    const deviceKeyPair = await ensureDeviceKey(stored)
    // A stand-in person key. Where it really lives is the passkey and backup
    // prototypes' question. Here it sits in this origin's IndexedDB and is
    // lost with it, which is what makes the vouch necessary.
    const personKeyPair = await generateSigningKeyPair()
    const cert = await createPersonCertificate(
      {
        deviceKey: await exportPublicKey(deviceKeyPair.publicKey),
        deviceLabel: deviceLabel(),
        issuedAt: new Date(),
      },
      personKeyPair,
    )
    const result = await api<{ ok: boolean; error?: string }>('/api/enroll', {
      cert,
      name,
      pin: pin || undefined,
    })
    if (!result.ok) {
      document.getElementById('error')!.textContent =
        `Could not join: ${result.error}`
      return
    }
    stored.personKeyPair = personKeyPair
    stored.personName = name
    await save(stored)
    render(`<div class="card ok"><h1>Welcome, ${escapeHtml(name)}</h1>
      <p>This phone is signed by your own person key.</p></div>
      <button class="secondary" id="forget">Forget this phone (test again)</button>`)
    document.getElementById('forget')!.onclick = async () => {
      await save({})
      location.reload()
    }
  }
}

async function showRoster(stored: Stored) {
  const roster = await api<{
    hostKey: string
    people: { personKey: string; name: string }[]
  }>('/api/roster')
  if (roster.hostKey !== hostKey) {
    render(
      `<div class="card"><p class="error">This host's key does not match the QR code. Scan the QR code shown on the host.</p></div>`,
    )
    return
  }
  const fingerprint = await keyFingerprint(hostKey)
  render(`
    <div class="card">
      <h1>Who are you?</h1>
      <div class="people">
        ${roster.people
          .map(
            (person) =>
              `<button class="person" data-key="${escapeHtml(person.personKey)}" data-name="${escapeHtml(person.name)}">${escapeHtml(person.name)}</button>`,
          )
          .join('')}
      </div>
    </div>
    <button class="secondary" id="new">I'm new here</button>
    <p class="muted center">Host ${fingerprint} · loaded ${seconds(Date.now() - pageLoadedAt)} ago</p>
  `)
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '.person',
  )) {
    button.onclick = () =>
      pickPerson(stored, button.dataset.key!, button.dataset.name!)
  }
  document.getElementById('new')!.onclick = () => showEnroll(stored)
}

async function start() {
  if (!crypto.subtle || !hostKey) {
    render(
      `<div class="card"><p class="error">Open this page from the host's QR code, over https.</p></div>`,
    )
    return
  }
  const stored = await load()
  if (stored.vouch) return showVouched(stored)
  if (stored.requestId) return showWaiting(stored)
  if (stored.personKeyPair) {
    render(`<div class="card ok"><h1>Welcome back, ${escapeHtml(stored.personName ?? '')}</h1>
      <p>This phone still has your person key. No vouch needed.</p></div>`)
    return
  }
  return showRoster(stored)
}

start().catch((error: unknown) => {
  render(
    `<div class="card"><p class="error">${escapeHtml(String(error))}</p></div>`,
  )
})
