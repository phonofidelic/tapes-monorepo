import crypto from 'crypto'
import {
  checkDeviceCertificate,
  checkJoinRequest,
  checkVouchRequest,
  createDeviceVouch,
  keyFingerprint,
  statementAddress,
  type DeviceVouch,
  type Signed,
  type VouchMethod,
  type VouchRequest,
} from '@tapes-monorepo/provenance'
import {
  isValidPin,
  sanitizeLabel,
  type RosterPerson,
} from '@tapes-monorepo/sync-protocol'
import type { PersonRoster } from './personRoster'
import { hashPin, pinMatches } from './pinHash'

/**
 * The host's side of vouching, free of HTTP so it can be tested. People join
 * the roster from their first device. A new device of theirs asks to be
 * vouched for, and the host signs a vouch once the operator confirms the
 * person or they type their PIN.
 *
 * Wrong PINs are counted per person, not per device, because a guesser can
 * make a new device key for every try. The counts and the waiting requests
 * are kept in memory, so a restart clears them.
 *
 * Do not import `electron` here. The sync server uses this module.
 */

/** A band is four or five people. This leaves room without letting a flood in. */
export const MAX_PENDING = 16

/** A request nobody answers in this time is dropped. */
export const PENDING_TTL_MS = 10 * 60_000

export const MAX_PIN_FAILURES = 5

export type JoinResult =
  | { ok: true }
  | {
      ok: false
      error:
        | 'malformed'
        | 'bad-signature'
        | 'stale-challenge'
        | 'certificate-mismatch'
        | 'bad-name'
        | 'bad-pin'
    }

export type RequestResult =
  | { ok: true; id: string }
  | {
      ok: false
      error:
        'malformed' | 'bad-signature' | 'unknown-person' | 'too-many-pending'
    }

export type PinResult =
  | { ok: true; vouch: Signed<DeviceVouch> }
  | { ok: false; error: 'wrong-pin'; attemptsLeft: number }
  | { ok: false; error: 'locked' | 'no-pin' | 'not-pending' }

/** A new device waiting for the operator or a PIN. */
export type PendingVouch = {
  id: string
  personName: string
  deviceLabel: string
  /** For the operator to tell two phones with the same label apart. */
  deviceFingerprint: string
  /** The host's clock. */
  receivedAt: string
}

type Entry = {
  id: string
  request: VouchRequest
  personName: string
  deviceFingerprint: string
  receivedAt: number
  status: 'pending' | 'rejected' | 'vouched'
  vouch?: Signed<DeviceVouch>
}

export function createHostVouching({
  roster,
  loadSigningKey,
  hostLabel,
  consumeChallenge,
  now = Date.now,
  onChange,
}: {
  roster: PersonRoster
  loadSigningKey: () => Promise<CryptoKeyPair>
  /** Read at signing time, so a rename applies to the next vouch. */
  hostLabel: () => string
  consumeChallenge: (challenge: string) => boolean
  now?: () => number
  /** Called when the list of waiting requests changes. */
  onChange?: () => void
}) {
  const entries = new Map<string, Entry>()
  const pinFailures = new Map<string, number>()

  const isLocked = (personKey: string) =>
    (pinFailures.get(personKey) ?? 0) >= MAX_PIN_FAILURES

  function dropStale() {
    const cutoff = now() - PENDING_TTL_MS
    let dropped = false
    for (const [id, entry] of entries) {
      if (entry.receivedAt < cutoff) {
        entries.delete(id)
        dropped ||= entry.status === 'pending'
      }
    }
    if (dropped) {
      onChange?.()
    }
  }

  const pendingEntry = (id: string) => {
    dropStale()
    const entry = entries.get(id)
    return entry?.status === 'pending' ? entry : undefined
  }

  async function vouchFor(
    entry: Entry,
    method: VouchMethod,
  ): Promise<Signed<DeviceVouch>> {
    const person = await roster.find(entry.request.personKey)
    if (!person) {
      throw new Error('A pending request names a person not on the roster')
    }
    const vouch = await createDeviceVouch(
      {
        request: entry.request,
        hostLabel: hostLabel(),
        personName: person.name,
        method,
        firstCertificate: person.firstCertificate.address,
        vouchedAt: new Date(now()),
      },
      await loadSigningKey(),
    )
    entry.status = 'vouched'
    entry.vouch = vouch
    onChange?.()
    return vouch
  }

  return {
    /** People a new device can pick from. Never includes PIN hashes. */
    async roster(): Promise<RosterPerson[]> {
      return (await roster.list()).map(({ personKey, name, pin }) => ({
        personKey,
        name,
        hasPin: pin !== undefined,
        pinLocked: isLocked(personKey),
      }))
    },

    /**
     * Adds the signer to the roster, or renames them. A later join keeps the
     * first certificate and the first PIN.
     */
    async join(
      join: Signed<unknown>,
      certificate: Signed<unknown>,
      pin: unknown,
    ): Promise<JoinResult> {
      const joinCheck = await checkJoinRequest(join)
      if (!joinCheck.ok) {
        return { ok: false, error: joinCheck.problem }
      }
      const request = joinCheck.request.payload
      // Used up even when a later check fails, so a request works once.
      if (!consumeChallenge(request.challenge)) {
        return { ok: false, error: 'stale-challenge' }
      }
      const certificateCheck = await checkDeviceCertificate(certificate)
      if (
        !certificateCheck.ok ||
        certificateCheck.certificate.payload.personKey !== request.personKey ||
        (await statementAddress(certificateCheck.certificate)) !==
          request.certificate
      ) {
        return { ok: false, error: 'certificate-mismatch' }
      }
      const name = sanitizeLabel(request.personName)
      if (!name) {
        return { ok: false, error: 'bad-name' }
      }
      if (pin !== undefined && !isValidPin(pin)) {
        return { ok: false, error: 'bad-pin' }
      }

      const existing = await roster.find(request.personKey)
      await roster.put(
        existing
          ? { ...existing, name }
          : {
              personKey: request.personKey,
              name,
              firstCertificate: {
                address: request.certificate,
                signed: certificateCheck.certificate,
              },
              ...(pin !== undefined && { pin: await hashPin(pin) }),
              joinedAt: new Date(now()).toISOString(),
            },
      )
      return { ok: true }
    },

    /** A new device asks to be vouched for as a person on the roster. */
    async request(signed: Signed<unknown>): Promise<RequestResult> {
      dropStale()
      const check = await checkVouchRequest(signed)
      if (!check.ok) {
        return { ok: false, error: check.problem }
      }
      const request = check.request.payload
      const person = await roster.find(request.personKey)
      if (!person) {
        return { ok: false, error: 'unknown-person' }
      }
      // A device that asks twice, such as after a reload, keeps one entry.
      const pending = [...entries.values()].filter(
        (entry) => entry.status === 'pending',
      )
      const existing = pending.find(
        (entry) =>
          entry.request.deviceKey === request.deviceKey &&
          entry.request.personKey === request.personKey,
      )
      if (existing) {
        return { ok: true, id: existing.id }
      }
      if (pending.length >= MAX_PENDING) {
        return { ok: false, error: 'too-many-pending' }
      }
      const entry: Entry = {
        id: crypto.randomUUID(),
        request,
        personName: person.name,
        deviceFingerprint: (await keyFingerprint(request.deviceKey)) ?? '?',
        receivedAt: now(),
        status: 'pending',
      }
      entries.set(entry.id, entry)
      onChange?.()
      return { ok: true, id: entry.id }
    },

    /** Where a request stands, for the guest that is waiting on it. */
    status(id: string) {
      dropStale()
      const entry = entries.get(id)
      if (!entry) {
        return undefined
      }
      return entry.status === 'vouched'
        ? { status: 'vouched' as const, vouch: entry.vouch! }
        : { status: entry.status }
    },

    /** Requests waiting for the operator, oldest first. */
    pending(): PendingVouch[] {
      dropStale()
      return [...entries.values()]
        .filter((entry) => entry.status === 'pending')
        .map((entry) => ({
          id: entry.id,
          personName: entry.personName,
          deviceLabel: entry.request.deviceLabel,
          deviceFingerprint: entry.deviceFingerprint,
          receivedAt: new Date(entry.receivedAt).toISOString(),
        }))
    },

    /** The operator says "yes, that is Sam's phone". */
    async confirm(id: string): Promise<Signed<DeviceVouch> | undefined> {
      const entry = pendingEntry(id)
      return entry ? vouchFor(entry, 'operator') : undefined
    },

    reject(id: string): void {
      const entry = pendingEntry(id)
      if (entry) {
        entry.status = 'rejected'
        onChange?.()
      }
    },

    /** The person types their PIN on the new device instead. */
    async enterPin(id: string, pin: string): Promise<PinResult> {
      const entry = pendingEntry(id)
      if (!entry) {
        return { ok: false, error: 'not-pending' }
      }
      const { personKey } = entry.request
      const person = await roster.find(personKey)
      if (!person?.pin) {
        return { ok: false, error: 'no-pin' }
      }
      if (isLocked(personKey)) {
        return { ok: false, error: 'locked' }
      }
      // Counted before the slow hash, so parallel guesses cannot all slip in
      // under the limit.
      const failures = (pinFailures.get(personKey) ?? 0) + 1
      pinFailures.set(personKey, failures)
      if (await pinMatches(pin, person.pin)) {
        pinFailures.delete(personKey)
        return { ok: true, vouch: await vouchFor(entry, 'pin') }
      }
      return failures >= MAX_PIN_FAILURES
        ? { ok: false, error: 'locked' }
        : {
            ok: false,
            error: 'wrong-pin',
            attemptsLeft: MAX_PIN_FAILURES - failures,
          }
    },
  }
}

export type HostVouching = ReturnType<typeof createHostVouching>
