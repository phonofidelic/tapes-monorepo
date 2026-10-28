import crypto from 'crypto'
import { promisify } from 'util'
import { isValidPin } from '@tapes-monorepo/sync-protocol'

/**
 * The short PIN a person can type on a new device instead of waiting for the
 * operator. The host keeps only a salted PBKDF2 hash.
 *
 * A 4-digit PIN has 10,000 values, so the hash alone cannot protect it from
 * someone who copies the host's files. The per-person attempt limit is what
 * protects it on the LAN. The iteration count only slows a copied file down.
 */

const pbkdf2 = promisify(crypto.pbkdf2)

export type PinHash = { salt: string; hash: string; iterations: number }

const DEFAULT_ITERATIONS = 100_000

async function derive(
  pin: string,
  salt: Buffer,
  iterations: number,
): Promise<Buffer> {
  return pbkdf2(pin, salt, iterations, 32, 'sha256')
}

export async function hashPin(
  pin: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<PinHash> {
  const salt = crypto.randomBytes(16)
  return {
    salt: salt.toString('base64url'),
    hash: (await derive(pin, salt, iterations)).toString('base64url'),
    iterations,
  }
}

export async function pinMatches(
  pin: string,
  stored: PinHash,
): Promise<boolean> {
  if (!isValidPin(pin)) {
    return false
  }
  const expected = Buffer.from(stored.hash, 'base64url')
  const actual = await derive(
    pin,
    Buffer.from(stored.salt, 'base64url'),
    stored.iterations,
  )
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  )
}

export function isPinHash(value: unknown): value is PinHash {
  const pin = value as Partial<PinHash> | null
  return (
    typeof pin === 'object' &&
    pin !== null &&
    typeof pin.salt === 'string' &&
    typeof pin.hash === 'string' &&
    Number.isInteger(pin.iterations)
  )
}
