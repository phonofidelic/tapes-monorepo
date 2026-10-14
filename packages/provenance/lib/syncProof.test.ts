import { describe, expect, it } from 'vitest'
import { exportPublicKey, generateSigningKeyPair } from './signing'
import { checkSyncProof, createSyncProof } from './syncProof'

describe('checkSyncProof', () => {
  it('returns the device key for a proof over the challenge', async () => {
    const keyPair = await generateSigningKeyPair()

    const proof = await createSyncProof('challenge-1', keyPair)

    expect(await checkSyncProof(proof, 'challenge-1')).toBe(
      await exportPublicKey(keyPair.publicKey),
    )
  })

  it('rejects a proof over another challenge', async () => {
    const proof = await createSyncProof(
      'challenge-1',
      await generateSigningKeyPair(),
    )

    expect(await checkSyncProof(proof, 'challenge-2')).toBeUndefined()
  })

  it('rejects a proof that names a key it was not signed with', async () => {
    const proof = await createSyncProof(
      'challenge-1',
      await generateSigningKeyPair(),
    )
    const other = await exportPublicKey(
      (await generateSigningKeyPair()).publicKey,
    )

    expect(
      await checkSyncProof(
        { ...proof, payload: { ...proof.payload, deviceKey: other } },
        'challenge-1',
      ),
    ).toBeUndefined()
  })

  it('rejects a payload that is not a proof', async () => {
    expect(
      await checkSyncProof({ payload: null, signature: 'x' }, 'challenge-1'),
    ).toBeUndefined()
  })
})
