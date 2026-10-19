/**
 * THROWAWAY (TAP-218). Generated word-list passphrases from the EFF long list
 * (7,776 words, about 12.9 bits each), and the normalization applied to every
 * passphrase before key derivation.
 */

// The EFF long list (CC BY 3.0 US), as packaged by eff-diceware-passphrase.
// https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases
import wordlist from './effLargeWordlist.json'

export const WORDS: readonly string[] = wordlist as string[]

export const BITS_PER_WORD = Math.log2(WORDS.length)

/** Six words is about 77 bits, EFF's and Diceware's current advice. */
export const DEFAULT_WORD_COUNT = 6

export function generatePassphrase(words = DEFAULT_WORD_COUNT): string {
  const picked: string[] = []
  while (picked.length < words) {
    picked.push(WORDS[randomBelow(WORDS.length)])
  }
  return picked.join(' ')
}

/**
 * Applied on both wrap and unwrap. Phone keyboards capitalize the first word
 * and add double spaces, and people type hyphens or dots between words. None
 * of those should lock someone out. The cost is that case in a chosen
 * passphrase adds no strength.
 */
export function normalizePassphrase(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s.,_]+/g, ' ')
    .trim()
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
