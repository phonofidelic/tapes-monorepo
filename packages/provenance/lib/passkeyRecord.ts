/**
 * The statement a person key signs to put a passkey record in a store, and
 * the checks a store runs before writing one.
 *
 * A record is useless without the passkey that unlocks it, so the risk a
 * store guards against is not reading but writing: an overwrite would take
 * away a person's way back from a lost phone. Only the person key can sign a
 * write, and the signature covers the record's bytes and a host challenge.
 */

import { sha256Hex } from './encoding'
import { exportPublicKey, signStatement, verifyStatement } from './signing'
import {
  PASSKEY_RECORD_WRITE_TYPE,
  type PasskeyRecordWrite,
  type Signed,
} from './types'

/** What the write's `record` field holds: the hash of the text form. */
export function passkeyRecordDigest(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text))
}

export async function createPasskeyRecordWrite(
  details: { credentialId: string; record: string; challenge: string },
  personKeyPair: CryptoKeyPair,
): Promise<Signed<PasskeyRecordWrite>> {
  return signStatement(
    {
      type: PASSKEY_RECORD_WRITE_TYPE,
      personKey: await exportPublicKey(personKeyPair.publicKey),
      credentialId: details.credentialId,
      record: await passkeyRecordDigest(details.record),
      challenge: details.challenge,
    },
    personKeyPair.privateKey,
  )
}

export type PasskeyRecordWriteCheck =
  | { ok: true; write: Signed<PasskeyRecordWrite> }
  | { ok: false; problem: 'malformed' | 'bad-signature' | 'wrong-record' }

/**
 * Checks the write's shape, that its person key signed it, and that it is the
 * record the caller received. The caller must still consume its challenge and
 * decide whether it knows that person.
 */
export async function checkPasskeyRecordWrite(
  signed: Signed<unknown>,
  record: string,
): Promise<PasskeyRecordWriteCheck> {
  const { payload } = signed
  if (!isPasskeyRecordWrite(payload)) {
    return { ok: false, problem: 'malformed' }
  }
  if (!(await verifyStatement(signed, payload.personKey))) {
    return { ok: false, problem: 'bad-signature' }
  }
  if (payload.record !== (await passkeyRecordDigest(record))) {
    return { ok: false, problem: 'wrong-record' }
  }
  return { ok: true, write: { payload, signature: signed.signature } }
}

function isPasskeyRecordWrite(payload: unknown): payload is PasskeyRecordWrite {
  const write = payload as Partial<PasskeyRecordWrite> | null
  return (
    typeof write === 'object' &&
    write !== null &&
    write.type === PASSKEY_RECORD_WRITE_TYPE &&
    typeof write.personKey === 'string' &&
    typeof write.credentialId === 'string' &&
    typeof write.record === 'string' &&
    typeof write.challenge === 'string'
  )
}
