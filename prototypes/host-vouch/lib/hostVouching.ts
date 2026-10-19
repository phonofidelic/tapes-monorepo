/**
 * THROWAWAY PROTOTYPE (TAP-219). Not production code.
 *
 * The host's side of vouching, free of HTTP so it can be tested: who the host
 * knows, which new devices are waiting, and signing a vouch once the operator
 * or a PIN confirms the person. State is plain data so the server can save it
 * to a JSON file between restarts, which stand in for an IP change.
 */

import { keyFingerprint, type Signed } from '@tapes-monorepo/provenance'
import {
  checkPersonCertificate,
  checkVouchRequest,
  createDeviceVouch,
  statementAddress,
  type DeviceVouch,
  type PersonCertificate,
  type VouchMethod,
  type VouchRequest,
} from './statements'
import { createPinGuard, hashPin, isValidPin, type PinRecord } from './pin'

/** A person this host has met. The host never holds their private key. */
export type KnownPerson = {
  personKey: string
  name: string
  /** Address of the person certificate they enrolled with. */
  basis: string
  pin?: PinRecord
  enrolledAt: string
}

export type PendingRequest = {
  id: string
  request: Signed<VouchRequest>
  personName: string
  deviceFingerprint: string
  /** The host's clock. */
  receivedAt: string
  status: 'pending' | 'vouched' | 'rejected'
  vouch?: Signed<DeviceVouch>
}

export type VouchLogEntry = {
  personName: string
  deviceLabel?: string
  method: VouchMethod
  waitedMs: number
  vouchedAt: string
}

export type HostVouchingState = {
  people: KnownPerson[]
  /** Kept so a request id stays readable after the guest's poll misses one. */
  requests: PendingRequest[]
  log: VouchLogEntry[]
}

export const emptyState = (): HostVouchingState => ({
  people: [],
  requests: [],
  log: [],
})

/** A band is four or five people. This leaves room without letting a flood in. */
export const MAX_PENDING = 16

/** A request nobody answers in this time is dropped. */
export const PENDING_TTL_MS = 10 * 60_000

export type EnrollResult =
  { ok: true; person: KnownPerson } | { ok: false; error: string }

export type RequestResult =
  { ok: true; id: string } | { ok: false; error: string }

export type PinResult =
  | { ok: true; vouch: Signed<DeviceVouch> }
  | { ok: false; error: 'wrong-pin'; attemptsLeft: number }
  | { ok: false; error: 'locked' | 'no-pin' | 'not-pending' }

export function createHostVouching({
  state,
  hostKeyPair,
  now = () => new Date(),
  newId = () => crypto.randomUUID(),
  maxPinFailures = 5,
}: {
  state: HostVouchingState
  hostKeyPair: CryptoKeyPair
  now?: () => Date
  newId?: () => string
  maxPinFailures?: number
}) {
  // Lockouts are kept in memory only. A host restart clears them, which is
  // acceptable for a prototype but not for the real thing.
  const pins = createPinGuard({ maxFailures: maxPinFailures })

  const findPerson = (personKey: string) =>
    state.people.find((person) => person.personKey === personKey)

  function dropStale() {
    const cutoff = now().getTime() - PENDING_TTL_MS
    state.requests = state.requests.filter(
      (entry) =>
        entry.status !== 'pending' || Date.parse(entry.receivedAt) >= cutoff,
    )
  }

  async function vouchFor(
    entry: PendingRequest,
    method: VouchMethod,
  ): Promise<Signed<DeviceVouch>> {
    const person = findPerson(entry.request.payload.personKey)!
    const vouchedAt = now()
    const vouch = await createDeviceVouch(
      {
        request: entry.request.payload,
        personName: person.name,
        method,
        basis: person.basis,
        vouchedAt,
      },
      hostKeyPair,
    )
    entry.status = 'vouched'
    entry.vouch = vouch
    state.log.push({
      personName: person.name,
      deviceLabel: entry.request.payload.deviceLabel,
      method,
      waitedMs: vouchedAt.getTime() - Date.parse(entry.receivedAt),
      vouchedAt: vouchedAt.toISOString(),
    })
    return vouch
  }

  return {
    state,

    /** People a re-joining guest can pick from. Never includes PIN hashes. */
    roster() {
      return state.people.map(({ personKey, name, pin }) => ({
        personKey,
        name,
        hasPin: pin !== undefined,
        pinLocked: pins.isLocked(personKey),
      }))
    },

    /**
     * First meeting. The person key signed a certificate for the device, so
     * the host can later point its vouches back to it.
     */
    async enroll(
      signed: Signed<unknown>,
      name: string,
      pin?: string,
    ): Promise<EnrollResult> {
      const check = await checkPersonCertificate(signed)
      if (!check.ok) {
        return { ok: false, error: check.problem }
      }
      const cert: PersonCertificate = check.statement.payload
      if (findPerson(cert.personKey)) {
        return { ok: false, error: 'already-enrolled' }
      }
      if (pin !== undefined && pin !== '' && !isValidPin(pin)) {
        return { ok: false, error: 'bad-pin' }
      }
      const person: KnownPerson = {
        personKey: cert.personKey,
        name,
        basis: await statementAddress(check.statement),
        pin: pin ? await hashPin(pin) : undefined,
        enrolledAt: now().toISOString(),
      }
      state.people.push(person)
      return { ok: true, person }
    },

    /** A new device asks to be vouched for as a person the host knows. */
    async request(signed: Signed<unknown>): Promise<RequestResult> {
      dropStale()
      const check = await checkVouchRequest(signed)
      if (!check.ok) {
        return { ok: false, error: check.problem }
      }
      const person = findPerson(check.statement.payload.personKey)
      if (!person) {
        return { ok: false, error: 'unknown-person' }
      }
      // A device that asks twice, such as after a reload, keeps one entry.
      const existing = state.requests.find(
        (entry) =>
          entry.status === 'pending' &&
          entry.request.payload.deviceKey === check.statement.payload.deviceKey,
      )
      if (existing) {
        return { ok: true, id: existing.id }
      }
      const pending = state.requests.filter((r) => r.status === 'pending')
      if (pending.length >= MAX_PENDING) {
        return { ok: false, error: 'too-many-pending' }
      }
      const entry: PendingRequest = {
        id: newId(),
        request: check.statement,
        personName: person.name,
        deviceFingerprint:
          (await keyFingerprint(check.statement.payload.deviceKey)) ?? '?',
        receivedAt: now().toISOString(),
        status: 'pending',
      }
      state.requests.push(entry)
      return { ok: true, id: entry.id }
    },

    get(id: string) {
      dropStale()
      return state.requests.find((entry) => entry.id === id)
    },

    pending() {
      dropStale()
      return state.requests.filter((entry) => entry.status === 'pending')
    },

    /** The operator says "yes, that is Sam's phone". */
    async confirm(id: string): Promise<Signed<DeviceVouch> | undefined> {
      const entry = state.requests.find((r) => r.id === id)
      if (entry?.status !== 'pending') {
        return undefined
      }
      return vouchFor(entry, 'operator')
    },

    reject(id: string) {
      const entry = state.requests.find((r) => r.id === id)
      if (entry?.status === 'pending') {
        entry.status = 'rejected'
      }
    },

    /** The person types their PIN on the new device instead. */
    async enterPin(id: string, pin: string): Promise<PinResult> {
      const entry = state.requests.find((r) => r.id === id)
      if (entry?.status !== 'pending') {
        return { ok: false, error: 'not-pending' }
      }
      const person = findPerson(entry.request.payload.personKey)!
      if (!person.pin) {
        return { ok: false, error: 'no-pin' }
      }
      const attempt = await pins.attempt(person.personKey, pin, person.pin)
      if (attempt.result === 'locked') {
        return { ok: false, error: 'locked' }
      }
      if (attempt.result === 'wrong') {
        return {
          ok: false,
          error: 'wrong-pin',
          attemptsLeft: attempt.attemptsLeft,
        }
      }
      return { ok: true, vouch: await vouchFor(entry, 'pin') }
    },

    unlockPin(personKey: string) {
      pins.unlock(personKey)
    },
  }
}

export type HostVouching = ReturnType<typeof createHostVouching>
