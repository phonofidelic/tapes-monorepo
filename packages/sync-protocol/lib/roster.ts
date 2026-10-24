/**
 * The routes a guest uses to join a host's roster of people, and later to ask
 * the host to vouch for a new device key after it lost its keys.
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
 * `POST` with a `VouchRequestBody` asks for a vouch. `GET` on `/vouches/<id>`
 * reads its status, and `POST` on `/vouches/<id>/pin` with a `PinBody` tries a
 * PIN instead of waiting for the operator.
 */
export const VOUCHES_PATH = '/vouches'

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
  /** Only used when the person first joins. A later join keeps that PIN. */
  pin?: string
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

export type PinResponse =
  | { ok: true; vouch: string }
  | { ok: false; error: 'wrong-pin'; attemptsLeft: number }
  | { ok: false; error: 'locked' | 'no-pin' | 'not-pending' }

/** Four to six digits: quick to type on a phone and easy to remember. */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4,6}$/.test(pin)
}
