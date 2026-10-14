import { describe, expect, it } from 'vitest'
import {
  createSyncProof,
  encodeSignedStatement,
  exportPublicKey,
  generateSigningKeyPair,
} from '@tapes-monorepo/provenance'
import { withSyncProof } from '@tapes-monorepo/sync-protocol'
import { createSyncChallengeStore, readProvenDeviceKey } from './syncChallenges'

describe('createSyncChallengeStore', () => {
  it('accepts an issued challenge once', () => {
    const challenges = createSyncChallengeStore()
    const challenge = challenges.issue()

    expect(challenges.consume(challenge)).toBe(true)
    expect(challenges.consume(challenge)).toBe(false)
  })

  it('rejects a challenge it never issued', () => {
    expect(createSyncChallengeStore().consume('made-up')).toBe(false)
  })

  it('rejects an expired challenge', () => {
    let clock = 0
    const challenges = createSyncChallengeStore({
      ttlMs: 1000,
      now: () => clock,
    })
    const challenge = challenges.issue()

    clock = 1001

    expect(challenges.consume(challenge)).toBe(false)
  })

  it('evicts the oldest challenge when full', () => {
    const challenges = createSyncChallengeStore({ maxChallenges: 2 })
    const oldest = challenges.issue()
    const middle = challenges.issue()
    const newest = challenges.issue()

    expect(challenges.consume(oldest)).toBe(false)
    expect(challenges.consume(middle)).toBe(true)
    expect(challenges.consume(newest)).toBe(true)
  })
})

describe('readProvenDeviceKey', () => {
  const syncUrl = 'ws://127.0.0.1:9001/?t=secret'

  it('returns the key a proof over an issued challenge shows', async () => {
    const challenges = createSyncChallengeStore()
    const keyPair = await generateSigningKeyPair()
    const proof = await createSyncProof(challenges.issue(), keyPair)
    const url = new URL(withSyncProof(syncUrl, encodeSignedStatement(proof)))

    expect(await readProvenDeviceKey(url, challenges)).toBe(
      await exportPublicKey(keyPair.publicKey),
    )
    // The same url again, as a replay or a reconnect would send it.
    expect(await readProvenDeviceKey(url, challenges)).toBeUndefined()
  })

  it('ignores a proof over a challenge this host did not issue', async () => {
    const proof = await createSyncProof(
      'made-up',
      await generateSigningKeyPair(),
    )
    const url = new URL(withSyncProof(syncUrl, encodeSignedStatement(proof)))

    expect(
      await readProvenDeviceKey(url, createSyncChallengeStore()),
    ).toBeUndefined()
  })

  it('ignores a url without a proof', async () => {
    expect(
      await readProvenDeviceKey(new URL(syncUrl), createSyncChallengeStore()),
    ).toBeUndefined()
  })

  it('ignores a proof that does not decode', async () => {
    expect(
      await readProvenDeviceKey(
        new URL(withSyncProof(syncUrl, 'not-a-statement')),
        createSyncChallengeStore(),
      ),
    ).toBeUndefined()
  })
})
