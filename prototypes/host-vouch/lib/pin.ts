/**
 * THROWAWAY PROTOTYPE (TAP-219). Not production code.
 *
 * The short PIN a person can enter instead of waiting for the operator. The
 * host keeps only a salted PBKDF2 hash. A wrong guess counts against the
 * person, and after a few the PIN path locks until the operator unlocks it.
 * The operator path always stays open, so a lockout never strands anyone.
 */

const encoder = new TextEncoder()

/** Four to six digits: quick to type on a phone, easy to remember. */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4,6}$/.test(pin)
}

export type PinRecord = { salt: string; hash: string; iterations: number }

// A 4-digit PIN has 10,000 values, so the hash alone cannot protect it from
// someone who copies the host's files. The attempt limit is what protects it
// on the LAN. The iteration count only slows a copied file down a little.
const DEFAULT_ITERATIONS = 100_000

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

async function derive(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  return toHex(new Uint8Array(bits))
}

export async function hashPin(
  pin: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<PinRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return {
    salt: toHex(salt),
    hash: await derive(pin, salt, iterations),
    iterations,
  }
}

export async function pinMatches(
  pin: string,
  record: PinRecord,
): Promise<boolean> {
  const hash = await derive(pin, fromHex(record.salt), record.iterations)
  // Both are 64 hex characters. Compare every one so timing says nothing.
  let difference = hash.length ^ record.hash.length
  for (let i = 0; i < hash.length; i++) {
    difference |= hash.charCodeAt(i) ^ record.hash.charCodeAt(i)
  }
  return difference === 0
}

export type PinAttempt =
  | { result: 'ok' }
  | { result: 'wrong'; attemptsLeft: number }
  | { result: 'locked' }

export type PinGuard = {
  attempt(
    personKey: string,
    pin: string,
    record: PinRecord,
  ): Promise<PinAttempt>
  isLocked(personKey: string): boolean
  /** The operator clears a lockout after checking who is asking. */
  unlock(personKey: string): void
}

/**
 * Counts wrong PINs per person, not per device. A guesser can make a new
 * device key for every try, so counting per device would not limit anything.
 * A correct PIN resets the count.
 */
export function createPinGuard({ maxFailures = 5 } = {}): PinGuard {
  const failures = new Map<string, number>()
  const isLocked = (personKey: string) =>
    (failures.get(personKey) ?? 0) >= maxFailures

  return {
    isLocked,
    unlock(personKey) {
      failures.delete(personKey)
    },
    async attempt(personKey, pin, record) {
      if (isLocked(personKey)) {
        return { result: 'locked' }
      }
      if (isValidPin(pin) && (await pinMatches(pin, record))) {
        failures.delete(personKey)
        return { result: 'ok' }
      }
      const count = (failures.get(personKey) ?? 0) + 1
      failures.set(personKey, count)
      return count >= maxFailures
        ? { result: 'locked' }
        : { result: 'wrong', attemptsLeft: maxFailures - count }
    },
  }
}
