/**
 * THROWAWAY (TAP-218). The settings the benchmark compares, shared by the
 * phone page and the Node baseline script so both measure the same thing.
 */

import { PROPOSED_ARGON2ID, PROPOSED_PBKDF2, type KdfParams } from './kdf'

export type BenchSetting = { params: KdfParams; proposed?: boolean }

export const BENCH_SETTINGS: BenchSetting[] = [
  { params: PROPOSED_PBKDF2, proposed: true },
  { params: { kdf: 'pbkdf2-sha256', iterations: 1_200_000 } },
  // OWASP's minimum Argon2id setting, for scale.
  {
    params: {
      kdf: 'argon2id',
      memoryKiB: 19 * 1024,
      iterations: 2,
      parallelism: 1,
    },
  },
  // Fallback if 64 MiB is too slow or runs out of memory on a phone.
  {
    params: {
      kdf: 'argon2id',
      memoryKiB: 46 * 1024,
      iterations: 1,
      parallelism: 1,
    },
  },
  { params: PROPOSED_ARGON2ID, proposed: true },
  {
    params: {
      kdf: 'argon2id',
      memoryKiB: 128 * 1024,
      iterations: 3,
      parallelism: 1,
    },
  },
]

export function summarize(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b)
  return {
    median: Math.round(sorted[Math.floor(sorted.length / 2)]),
    min: Math.round(sorted[0]),
    max: Math.round(sorted[sorted.length - 1]),
  }
}
