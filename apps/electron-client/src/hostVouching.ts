import crypto from 'crypto'
import {
  checkDeviceCertificate,
  checkJoinRequest,
  checkVouchRequest,
  createDeviceRevocation,
  createDeviceVouch,
  keyFingerprint,
  statementAddress,
  statementBytes,
  type DeviceVouch,
  type Signed,
  type VouchMethod,
  type VouchRequest,
} from '@tapes-monorepo/provenance'
import {
  isValidPin,
  sanitizeLabel,
  type RosterPerson,
  type SignedVouchState,
} from '@tapes-monorepo/sync-protocol'
import type { PersonRoster, RosterEntry, SignedVouch } from './personRoster'
import { hashPin, pinMatches } from './pinHash'

/**
 * The host's side of vouching, free of HTTP so it can be tested. People join
 * the roster from their first device. A new device of theirs asks to be
 * vouched for, and the host signs a vouch once the operator confirms the
 * person or they type their PIN.
 *
 * Every vouch it signs is written to the person's roster entry. The operator
 * can then withdraw one the host confirmed for the wrong person, long after
 * the request itself was dropped.
 *
 * Wrong PINs are counted per person, not per device, because a guesser can
 * make a new device key for every try. The counts are saved in the roster, so
 * a restart keeps them. The waiting requests are kept in memory only.
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

type PinCheck =
  | { ok: true }
  | { ok: false; error: 'wrong-pin'; attemptsLeft: number }
  | { ok: false; error: 'locked' | 'no-pin' }

export type PinResult =
  | { ok: true; vouch: Signed<DeviceVouch> }
  | { ok: false; error: 'wrong-pin'; attemptsLeft: number }
  | { ok: false; error: 'locked' | 'no-pin' | 'not-pending' }

export type PinChangeResult =
  PinCheck | { ok: false; error: 'unknown-person' | 'bad-pin' }

export type SetPinResult =
  { ok: true } | { ok: false; error: 'unknown-person' | 'bad-pin' }

/** A vouch the host signed, with the person it names. For the operator. */
export type SignedVouchSummary = SignedVouch & {
  personKey: string
  /** The roster's name for the person. */
  personName: string
}

export type RevokeVouchResult =
  | {
      ok: true
      /** Address of the Signed<DeviceRevocation> the host signed. */
      address: string
      /** The recordings that now list it. */
      listedOn: string[]
    }
  | {
      ok: false
      error: 'unknown-vouch' | 'already-revoked' | 'no-delivery'
    }

/**
 * Puts a signed revocation where readers will find it: stored on this host,
 * and listed on every recording whose statements name the vouch.
 */
export type RevocationDelivery = (details: {
  /** The root document whose recordings are searched. */
  docUrl: string
  bytes: Uint8Array
  /** Address of the revocation itself. */
  address: string
  /** Address of the vouch it withdraws. */
  deviceLink: string
}) => Promise<string[]>

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

const failuresOf = (entry: RosterEntry) => entry.pinFailures ?? 0

const isLocked = (entry: RosterEntry) => failuresOf(entry) >= MAX_PIN_FAILURES

export function createHostVouching({
  roster,
  loadSigningKey,
  hostLabel,
  consumeChallenge,
  deliverRevocation,
  now = Date.now,
  onChange,
}: {
  roster: PersonRoster
  loadSigningKey: () => Promise<CryptoKeyPair>
  /** Read at signing time, so a rename applies to the next vouch. */
  hostLabel: () => string
  consumeChallenge: (challenge: string) => boolean
  /**
   * Delivers a revocation the operator signed. Left out where there is no repo
   * or blob store to deliver it to, and revoking then fails rather than
   * signing a statement no reader would see.
   */
  deliverRevocation?: RevocationDelivery
  now?: () => number
  /** Called when the list of waiting requests changes. */
  onChange?: () => void
}) {
  const entries = new Map<string, Entry>()

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

  /** Checks a PIN against the person's, and counts it if it is wrong. */
  async function checkPin(personKey: string, pin: string): Promise<PinCheck> {
    // Counted and saved before the slow hash, one guess at a time. Parallel
    // guesses cannot slip in under the limit, and a restart forgets none.
    const counted = await roster.update(personKey, (entry) =>
      entry.pin && !isLocked(entry)
        ? { ...entry, pinFailures: failuresOf(entry) + 1 }
        : undefined,
    )
    if (!counted?.pin) {
      const person = await roster.find(personKey)
      return { ok: false, error: person?.pin ? 'locked' : 'no-pin' }
    }
    if (await pinMatches(pin, counted.pin)) {
      await roster.update(personKey, (entry) => ({
        ...entry,
        pinFailures: undefined,
      }))
      return { ok: true }
    }
    const failures = failuresOf(counted)
    return failures >= MAX_PIN_FAILURES
      ? { ok: false, error: 'locked' }
      : {
          ok: false,
          error: 'wrong-pin',
          attemptsLeft: MAX_PIN_FAILURES - failures,
        }
  }

  /** Replaces or removes the PIN. A new PIN starts with a clean count. */
  async function savePin(
    personKey: string,
    pin: string | null,
  ): Promise<boolean> {
    const hash = pin === null ? undefined : await hashPin(pin)
    const saved = await roster.update(personKey, (entry) => ({
      ...entry,
      pin: hash,
      pinFailures: undefined,
    }))
    return saved !== undefined
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
    const record: SignedVouch = {
      address: await statementAddress(vouch),
      deviceKey: vouch.payload.deviceKey,
      deviceLabel: vouch.payload.deviceLabel,
      deviceFingerprint: entry.deviceFingerprint,
      method,
      vouchedAt: vouch.payload.vouchedAt,
    }
    // Remembered before the guest is told, so a vouch the host handed out is
    // never one the operator cannot find again.
    await roster.update(person.personKey, (saved) => ({
      ...saved,
      vouches: [
        ...(saved.vouches ?? []).filter(
          (each) => each.address !== record.address,
        ),
        record,
      ],
    }))
    entry.status = 'vouched'
    entry.vouch = vouch
    onChange?.()
    return vouch
  }

  /** The person whose entry holds this vouch, and the vouch itself. */
  async function findVouch(address: string) {
    for (const person of await roster.list()) {
      const vouch = person.vouches?.find((each) => each.address === address)
      if (vouch) {
        return { person, vouch }
      }
    }
    return undefined
  }

  return {
    /** People a new device can pick from. Never includes PIN hashes. */
    async roster(): Promise<RosterPerson[]> {
      return (await roster.list()).map((entry) => ({
        personKey: entry.personKey,
        name: entry.name,
        hasPin: entry.pin !== undefined,
        pinLocked: entry.pin !== undefined && isLocked(entry),
      }))
    },

    /**
     * Adds the signer to the roster, or renames them. A later join keeps the
     * first certificate. It keeps the PIN too, unless `pin` is a new PIN or
     * `null` to remove it. The person key signed the join, so no old PIN is
     * needed, and a lockout is cleared.
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
      if (pin !== undefined && pin !== null && !isValidPin(pin)) {
        return { ok: false, error: 'bad-pin' }
      }
      const pinHash = typeof pin === 'string' ? await hashPin(pin) : undefined

      const renamed = await roster.update(request.personKey, (entry) => ({
        ...entry,
        name,
        ...(pin !== undefined && { pin: pinHash, pinFailures: undefined }),
      }))
      if (!renamed) {
        await roster.put({
          personKey: request.personKey,
          name,
          firstCertificate: {
            address: request.certificate,
            signed: certificateCheck.certificate,
          },
          ...(pinHash && { pin: pinHash }),
          joinedAt: new Date(now()).toISOString(),
        })
      }
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
      const deviceFingerprint = (await keyFingerprint(request.deviceKey)) ?? '?'
      // A device that asks twice, such as after a reload, keeps one entry.
      // No await from here to the insert, so two requests sent at once cannot
      // both miss each other and leave the guest waiting on the wrong one.
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
        deviceFingerprint,
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
      const check = await checkPin(entry.request.personKey, pin)
      return check.ok
        ? { ok: true, vouch: await vouchFor(entry, 'pin') }
        : check
    },

    /**
     * A person changes or removes their PIN from a device without the person
     * key. The old PIN proves it is them, and a wrong one counts as a guess.
     */
    async changePin(
      personKey: string,
      oldPin: string,
      pin: unknown,
    ): Promise<PinChangeResult> {
      if (pin !== null && !isValidPin(pin)) {
        return { ok: false, error: 'bad-pin' }
      }
      if (!(await roster.find(personKey))) {
        return { ok: false, error: 'unknown-person' }
      }
      const check = await checkPin(personKey, oldPin)
      if (!check.ok) {
        return check
      }
      return (await savePin(personKey, pin))
        ? { ok: true }
        : { ok: false, error: 'unknown-person' }
    },

    /**
     * The operator sets or removes a person's PIN at the host, after checking
     * who is asking. The person types the new PIN on the host.
     */
    async setPin(personKey: string, pin: unknown): Promise<SetPinResult> {
      if (pin !== null && !isValidPin(pin)) {
        return { ok: false, error: 'bad-pin' }
      }
      return (await savePin(personKey, pin))
        ? { ok: true }
        : { ok: false, error: 'unknown-person' }
    },

    /**
     * Where one vouch stands, for the device that holds it. Undefined when
     * this host signed no vouch at that address, as after its roster was
     * replaced, which is not the same as having withdrawn it.
     */
    async signedVouchState(
      address: string,
    ): Promise<SignedVouchState | undefined> {
      const found = await findVouch(address)
      if (!found) {
        return undefined
      }
      return found.vouch.revokedAt
        ? {
            state: 'withdrawn',
            revokedAt: found.vouch.revokedAt,
            ...(found.vouch.revocation && {
              revocation: found.vouch.revocation,
            }),
          }
        : { state: 'standing' }
    },

    /**
     * The vouches this host has signed, newest first. The operator's list, so
     * it names people rather than only keys.
     */
    async signedVouches(): Promise<SignedVouchSummary[]> {
      const people = await roster.list()
      return people
        .flatMap((person) =>
          (person.vouches ?? []).map((vouch) => ({
            ...vouch,
            personKey: person.personKey,
            personName: person.name,
          })),
        )
        .sort((first, second) =>
          second.vouchedAt.localeCompare(first.vouchedAt),
        )
    },

    /**
     * The operator withdraws a vouch, for a device the host confirmed as the
     * wrong person. The roster is marked after the revocation is delivered, so
     * a delivery that fails outright can be tried again.
     */
    async revokeVouch(
      address: string,
      details: { docUrl: string },
    ): Promise<RevokeVouchResult> {
      if (!deliverRevocation) {
        return { ok: false, error: 'no-delivery' }
      }
      const found = await findVouch(address)
      if (!found) {
        return { ok: false, error: 'unknown-vouch' }
      }
      if (found.vouch.revokedAt) {
        return { ok: false, error: 'already-revoked' }
      }
      const revocation = await createDeviceRevocation(
        {
          signedBy: 'host',
          deviceKey: found.vouch.deviceKey,
          deviceLink: address,
          reason: 'wrong-person',
          revokedAt: new Date(now()),
        },
        await loadSigningKey(),
      )
      const revocationAddress = await statementAddress(revocation)
      const listedOn = await deliverRevocation({
        docUrl: details.docUrl,
        bytes: statementBytes(revocation),
        address: revocationAddress,
        deviceLink: address,
      })
      await roster.update(found.person.personKey, (saved) => ({
        ...saved,
        vouches: (saved.vouches ?? []).map((each) =>
          each.address === address
            ? {
                ...each,
                revokedAt: revocation.payload.revokedAt,
                revocation: revocationAddress,
              }
            : each,
        ),
      }))
      return { ok: true, address: revocationAddress, listedOn }
    },

    /** The operator reopens a locked PIN after checking who is asking. */
    async unlockPin(personKey: string): Promise<boolean> {
      const person = await roster.find(personKey)
      if (!person) {
        return false
      }
      await roster.update(personKey, (entry) =>
        entry.pinFailures === undefined
          ? undefined
          : { ...entry, pinFailures: undefined },
      )
      return true
    },
  }
}

export type HostVouching = ReturnType<typeof createHostVouching>
