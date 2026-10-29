import { describe, expect, it } from 'vitest'
import {
  checkPasskeyRecordWrite,
  createPasskeyRecordWrite,
  passkeyRecordDigest,
} from './passkeyRecord'
import { exportPublicKey, generateSigningKeyPair } from './signing'

const personKey = () => generateSigningKeyPair(true)

const RECORD = '{"format":"tapes-person-key-backup","backup":"TPK1.AQL"}'

const details = {
  credentialId: 'KissLS4vMDEyMzQ1Njc4OTo7PD0',
  record: RECORD,
  challenge: 'a-challenge-from-the-host',
}

describe('createPasskeyRecordWrite', () => {
  it('names the signer, the credential and the record', async () => {
    const keyPair = await personKey()
    const write = await createPasskeyRecordWrite(details, keyPair)

    expect(write.payload).toEqual({
      type: 'tapes/passkey-record@1',
      personKey: await exportPublicKey(keyPair.publicKey),
      credentialId: details.credentialId,
      record: await passkeyRecordDigest(RECORD),
      challenge: details.challenge,
    })
  })
})

describe('checkPasskeyRecordWrite', () => {
  it('accepts a write over the record it was sent with', async () => {
    const keyPair = await personKey()
    const write = await createPasskeyRecordWrite(details, keyPair)

    const checked = await checkPasskeyRecordWrite(write, RECORD)
    if (!checked.ok) throw new Error(checked.problem)
    expect(checked.write.payload.personKey).toBe(
      await exportPublicKey(keyPair.publicKey),
    )
  })

  it('refuses a write over a different record', async () => {
    const write = await createPasskeyRecordWrite(details, await personKey())
    expect(await checkPasskeyRecordWrite(write, `${RECORD} `)).toEqual({
      ok: false,
      problem: 'wrong-record',
    })
  })

  it('refuses a signature from another key', async () => {
    const write = await createPasskeyRecordWrite(details, await personKey())
    const other = await createPasskeyRecordWrite(details, await personKey())

    expect(
      await checkPasskeyRecordWrite(
        { payload: write.payload, signature: other.signature },
        RECORD,
      ),
    ).toEqual({ ok: false, problem: 'bad-signature' })
  })

  it('refuses anything that is not a write', async () => {
    expect(
      await checkPasskeyRecordWrite(
        { payload: { type: 'other' }, signature: '' },
        RECORD,
      ),
    ).toEqual({ ok: false, problem: 'malformed' })
  })
})
