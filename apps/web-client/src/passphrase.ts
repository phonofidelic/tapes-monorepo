import { argon2id } from 'hash-wasm'
import type { DeriveBackupKey } from '@tapes-monorepo/provenance'
// The EFF long list (CC BY 3.0 US).
// https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases
import wordlist from './effLargeWordlist.json'

/**
 * The two pieces of the person key backup that stay out of the provenance
 * package: generated passphrases from the EFF long list, and Argon2id from
 * hash-wasm. Argon2id at the backup setting uses 64 MiB and runs for about a
 * second on a phone, so call it from the worker, never the page.
 */

export const WORDS: readonly string[] = wordlist as string[]

/** Six words is about 77 bits, EFF's current advice. */
export const PASSPHRASE_WORDS = 6

export function generatePassphrase(words = PASSPHRASE_WORDS): string {
  const picked: string[] = []
  while (picked.length < words) {
    picked.push(WORDS[randomBelow(WORDS.length)])
  }
  return picked.join(' ')
}

/** Uniform in [0, n) without modulo bias. */
function randomBelow(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n
  const buffer = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    if (buffer[0] < limit) {
      return buffer[0] % n
    }
  }
}

const encoder = new TextEncoder()

export const deriveArgon2id: DeriveBackupKey = async (
  passphrase,
  salt,
  params,
) => {
  const out = await argon2id({
    password: encoder.encode(passphrase),
    salt,
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: 'binary',
  })
  return new Uint8Array(out)
}
