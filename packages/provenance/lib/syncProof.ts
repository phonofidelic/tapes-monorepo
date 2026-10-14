/**
 * How a guest shows the host it holds its device key when it opens the sync
 * socket. The host issues a one-time challenge, and the guest signs it.
 *
 * The host checks that the challenge is one it issued and has not used. This
 * module only checks the signature and that the proof names that challenge.
 */

import { exportPublicKey, signStatement, verifyStatement } from './signing'
import { SYNC_PROOF_TYPE, type Signed, type SyncProof } from './types'

export async function createSyncProof(
  challenge: string,
  keyPair: CryptoKeyPair,
): Promise<Signed<SyncProof>> {
  return signStatement(
    {
      type: SYNC_PROOF_TYPE,
      challenge,
      deviceKey: await exportPublicKey(keyPair.publicKey),
    },
    keyPair.privateKey,
  )
}

/**
 * The device key a proof shows, or undefined when the proof is malformed, names
 * a different challenge, or does not verify against the key it names.
 */
export async function checkSyncProof(
  signed: Signed<unknown>,
  challenge: string,
): Promise<string | undefined> {
  const proof = signed.payload as Partial<SyncProof> | null
  if (
    typeof proof !== 'object' ||
    proof === null ||
    proof.type !== SYNC_PROOF_TYPE ||
    proof.challenge !== challenge ||
    typeof proof.deviceKey !== 'string'
  ) {
    return undefined
  }
  return (await verifyStatement(signed, proof.deviceKey))
    ? proof.deviceKey
    : undefined
}
