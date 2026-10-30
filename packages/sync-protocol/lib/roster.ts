/**
 * The routes a guest uses to join a host's roster of people, to ask the host
 * to vouch for a new device key after it lost its keys, and to read whether
 * the vouch it holds still stands.
 *
 * Every route is guarded by the pairing token, like the challenge route. The
 * signed statements travel encoded, as the provenance package encodes them.
 */

/**
 * `GET` lists the people on the roster. `POST` with a `JoinBody` adds the
 * signer or updates their name and PIN.
 */
export const ROSTER_PATH = '/people'

/**
 * `POST` with a `PinChangeBody` changes or removes a person's PIN, proven by
 * the old PIN. A device with the person key re-joins instead.
 */
export const PIN_CHANGE_PATH = `${ROSTER_PATH}/pin`

/**
 * `POST` with a `VouchRequestBody` asks for a vouch. `GET` on `/vouches/<id>`
 * reads its status, and `POST` on `/vouches/<id>/pin` with a `PinBody` tries a
 * PIN instead of waiting for the operator.
 */
export const VOUCHES_PATH = '/vouches'

/**
 * `GET` on `/vouches/state/<address>` says whether the host still stands
 * behind the vouch at that address. The asker holds that vouch already, so
 * this reports nothing it does not have, unlike the roster route.
 */
export const VOUCH_STATE_PATH = `${VOUCHES_PATH}/state`

/** One person on a host's roster, as guests see it. Never a PIN hash. */
export type RosterPerson = {
  personKey: string
  name: string
  hasPin: boolean
  /** Too many wrong PINs. Only the operator can confirm this person now. */
  pinLocked: boolean
}

export type RosterResponse = { people: RosterPerson[] }

export type JoinBody = {
  /** The encoded Signed<JoinRequest>. */
  join: string
  /** The encoded Signed<DeviceCertificate> the join request names. */
  certificate: string
  /**
   * A new PIN, or `null` to remove it. Left out, the host keeps the PIN it
   * has. The join is signed by the person key, so this needs no old PIN.
   */
  pin?: string | null
}

export type VouchRequestBody = {
  /** The encoded Signed<VouchRequest>. */
  request: string
}

export type VouchRequestResponse = { id: string }

export type PinBody = { pin: string }

export type VouchStatus =
  | { status: 'pending' }
  | { status: 'rejected' }
  /** `vouch` is the encoded Signed<DeviceVouch>. */
  | { status: 'vouched'; vouch: string }

/** Where one vouch the host signed stands. */
export type SignedVouchState =
  | { state: 'standing' }
  | {
      state: 'withdrawn'
      /** The host's clock when it signed the revocation. */
      revokedAt: string
      /** Address of the Signed<DeviceRevocation>, for a reader that wants it. */
      revocation?: string
    }

export type PinResponse =
  | { ok: true; vouch: string }
  | { ok: false; error: 'wrong-pin'; attemptsLeft: number }
  | { ok: false; error: 'locked' | 'no-pin' | 'not-pending' }

export type PinChangeBody = {
  personKey: string
  oldPin: string
  /** The new PIN, or `null` to remove it. */
  pin: string | null
}

export type PinChangeResponse =
  | { ok: true }
  | { ok: false; error: 'wrong-pin'; attemptsLeft: number }
  | {
      ok: false
      error: 'locked' | 'no-pin' | 'unknown-person' | 'bad-pin' | 'malformed'
    }

/** Four to six digits: quick to type on a phone and easy to remember. */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4,6}$/.test(pin)
}
