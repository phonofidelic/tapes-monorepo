import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkPasskeyRecordWrite,
  decodeSignedStatement,
  parseBackupText,
  passkeyRecordKey,
  personKeyServiceToken,
  toBase64Url,
} from '@tapes-monorepo/provenance'
import { createPersonIdentity } from './personKey'
import {
  personKeyStatus,
  recordPersonKeyWithPasskey,
  restorePersonKeyWithPasskey,
} from './personKeyRequests'

/**
 * The worker's half of passkey recovery: wrapping the stored person key for
 * a passkey, and taking it up again on a device that holds nothing.
 */

const PASSKEY = {
  prf: new Uint8Array(32).fill(3) as Uint8Array<ArrayBuffer>,
  rpId: 'tapes.network',
  credentialId: toBase64Url(new Uint8Array(20).fill(9)),
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The person key this device holds, as `person:create` makes it. */
async function thisDevicesPersonKey() {
  const { publicKey } = await createPersonIdentity({
    keyPair: await crypto.subtle
      .generateKey('Ed25519', false, ['sign', 'verify'])
      .then((keys) => keys as CryptoKeyPair),
    label: 'Pixel',
  })
  return publicKey
}

describe('recordPersonKeyWithPasskey', () => {
  it('wraps the person key and signs the write over the record', async () => {
    const personKey = await thisDevicesPersonKey()

    const written = await recordPersonKeyWithPasskey(PASSKEY, 'challenge-1')

    const record = parseBackupText(written.record)
    if (!record.ok) throw new Error(record.problem)
    expect(passkeyRecordKey(record.backup)).toBe(PASSKEY.credentialId)
    expect(toBase64Url(record.backup.publicKey)).toBe(personKey)
    expect(written.token).toBe(await personKeyServiceToken(PASSKEY.prf))

    const signed = decodeSignedStatement(written.write)
    if (!signed) throw new Error('the write did not decode')
    const checked = await checkPasskeyRecordWrite(signed, written.record)
    if (!checked.ok) throw new Error(checked.problem)
    expect(checked.write.payload).toMatchObject({
      personKey,
      credentialId: PASSKEY.credentialId,
      challenge: 'challenge-1',
    })
  })

  it('refuses where there is no person key to record', async () => {
    await expect(
      recordPersonKeyWithPasskey(PASSKEY, 'challenge-1'),
    ).rejects.toThrow(/no person key/)
  })
})

describe('restorePersonKeyWithPasskey', () => {
  it('takes the key up on a device that holds nothing', async () => {
    const personKey = await thisDevicesPersonKey()
    const { record } = await recordPersonKeyWithPasskey(PASSKEY, 'challenge-1')

    // A replacement phone: a new store, and only the passkey to go on.
    vi.stubGlobal('indexedDB', new IDBFactory())
    expect(await personKeyStatus()).toEqual({ exists: false })

    const result = await restorePersonKeyWithPasskey(
      record,
      PASSKEY.prf.slice() as Uint8Array<ArrayBuffer>,
      'New phone',
    )

    if (!result.ok) throw new Error(result.problem)
    expect(result.status).toMatchObject({
      exists: true,
      publicKey: personKey,
      passkeyRecordedAt: expect.any(String),
    })
    // The restored key certified this device, so the status survives a reload.
    expect(await personKeyStatus()).toMatchObject({ publicKey: personKey })
  })

  it('refuses another passkey', async () => {
    await thisDevicesPersonKey()
    const { record } = await recordPersonKeyWithPasskey(PASSKEY, 'challenge-1')

    vi.stubGlobal('indexedDB', new IDBFactory())
    expect(
      await restorePersonKeyWithPasskey(
        record,
        new Uint8Array(32).fill(4),
        'New phone',
      ),
    ).toEqual({ ok: false, problem: 'wrong-passkey' })
  })

  it('refuses anything that is not a record', async () => {
    expect(
      await restorePersonKeyWithPasskey('hello', PASSKEY.prf, 'New phone'),
    ).toEqual({ ok: false, problem: 'unreadable' })
  })
})
