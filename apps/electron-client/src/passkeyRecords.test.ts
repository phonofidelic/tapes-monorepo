import path from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  backupToFileText,
  createDeviceCertificate,
  createPasskeyRecordWrite,
  encodeSignedStatement,
  exportPublicKey,
  generateSigningKeyPair,
  personKeyServiceToken,
  statementAddress,
  toBase64Url,
  wrapPersonKey,
  wrapPersonKeyWithPasskey,
  type DeriveBackupKey,
} from '@tapes-monorepo/provenance'
import { MAX_RECORDS_PER_PERSON } from '@tapes-monorepo/sync-protocol'
import {
  createPasskeyRecordStore,
  FETCH_WINDOW_MS,
  MAX_FETCHES_PER_WINDOW,
} from './passkeyRecords'
import { createPersonRoster, type PersonRoster } from './personRoster'

let dir: string
let roster: PersonRoster
let clock: number
let issued: Set<string>

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tapes-records-'))
  roster = createPersonRoster(path.join(dir, 'people.json'))
  clock = Date.parse('2026-10-29T18:00:00.000Z')
  issued = new Set()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const challenge = () => {
  const value = `challenge-${issued.size}`
  issued.add(value)
  return value
}

/** Stands in for Argon2id, which only the web client carries. */
const derive: DeriveBackupKey = async (passphrase, salt) => {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 },
      base,
      256,
    ),
  )
}

const store = () =>
  createPasskeyRecordStore({
    roster,
    consumeChallenge: (value) => issued.delete(value),
    now: () => new Date(clock),
  })

/** A person on the roster, with their key pair. */
async function person(name = 'Ada') {
  const keyPair = await generateSigningKeyPair(true)
  const personKey = await exportPublicKey(keyPair.publicKey)
  const deviceKeys = await generateSigningKeyPair()
  const certificate = await createDeviceCertificate(
    {
      deviceKey: await exportPublicKey(deviceKeys.publicKey),
      deviceLabel: 'Phone',
    },
    keyPair,
  )
  await roster.put({
    personKey,
    name,
    firstCertificate: {
      address: await statementAddress(certificate),
      signed: certificate,
    },
    joinedAt: new Date(clock).toISOString(),
  })
  return { keyPair, personKey }
}

/** One passkey's answer, and the record it locks. */
async function record(keyPair: CryptoKeyPair) {
  const secret = {
    prf: crypto.getRandomValues(new Uint8Array(32)),
    rpId: 'tapes.network',
    credentialId: toBase64Url(crypto.getRandomValues(new Uint8Array(20))),
  }
  const backup = await wrapPersonKeyWithPasskey(keyPair, secret)
  return {
    secret,
    text: backupToFileText(backup, new Date(clock)),
    token: await personKeyServiceToken(secret.prf),
  }
}

async function write(
  keyPair: CryptoKeyPair,
  held: Awaited<ReturnType<typeof record>>,
  value = challenge(),
) {
  const signed = await createPasskeyRecordWrite(
    {
      credentialId: held.secret.credentialId,
      record: held.text,
      challenge: value,
    },
    keyPair,
  )
  return encodeSignedStatement(signed)
}

describe('storing a record', () => {
  it('keeps it for the person who signed the write', async () => {
    const { keyPair, personKey } = await person()
    const held = await record(keyPair)
    const records = store()

    expect(
      await records.put(await write(keyPair, held), held.text, held.token),
    ).toEqual({ ok: true })

    const entry = await roster.find(personKey)
    expect(entry?.passkeyRecords).toEqual([
      {
        credentialId: held.secret.credentialId,
        tokenHash: expect.any(String),
        record: held.text,
        storedAt: '2026-10-29T18:00:00.000Z',
      },
    ])
    // The token itself is never written down.
    expect(entry?.passkeyRecords?.[0].tokenHash).not.toBe(held.token)
  })

  it('replaces the record under the same credential id', async () => {
    const { keyPair, personKey } = await person()
    const first = await record(keyPair)
    const records = store()
    await records.put(await write(keyPair, first), first.text, first.token)

    // The same passkey, re-wrapped: a new salt, nonce and ciphertext.
    const again = await wrapPersonKeyWithPasskey(keyPair, first.secret)
    const second = {
      secret: first.secret,
      text: backupToFileText(again, new Date(clock)),
      token: first.token,
    }
    expect(
      await records.put(
        await write(keyPair, second),
        second.text,
        second.token,
      ),
    ).toEqual({ ok: true })

    const entry = await roster.find(personKey)
    expect(entry?.passkeyRecords).toHaveLength(1)
    expect(entry?.passkeyRecords?.[0].record).toBe(second.text)
  })

  it('refuses a write nobody on the roster signed', async () => {
    const stranger = await generateSigningKeyPair(true)
    const held = await record(stranger)

    expect(
      await store().put(await write(stranger, held), held.text, held.token),
    ).toEqual({ ok: false, error: 'unknown-person' })
  })

  it('refuses a write signed by another key', async () => {
    const { keyPair } = await person()
    const other = await generateSigningKeyPair(true)
    const held = await record(keyPair)
    const signed = await createPasskeyRecordWrite(
      {
        credentialId: held.secret.credentialId,
        record: held.text,
        challenge: challenge(),
      },
      keyPair,
    )
    const forged = await createPasskeyRecordWrite(
      {
        credentialId: held.secret.credentialId,
        record: held.text,
        challenge: challenge(),
      },
      other,
    )

    expect(
      await store().put(
        encodeSignedStatement({
          payload: signed.payload,
          signature: forged.signature,
        }),
        held.text,
        held.token,
      ),
    ).toEqual({ ok: false, error: 'bad-signature' })
  })

  it('refuses a record the write does not cover', async () => {
    const { keyPair } = await person()
    const held = await record(keyPair)
    const other = await record(keyPair)

    expect(
      await store().put(await write(keyPair, held), other.text, other.token),
    ).toEqual({ ok: false, error: 'bad-record' })
  })

  it('refuses a passphrase backup, which no passkey could open', async () => {
    const { keyPair } = await person()
    const held = await record(keyPair)
    const backup = await wrapPersonKey(keyPair, 'one two three four', derive)
    const text = backupToFileText(backup, new Date(clock))

    expect(
      await store().put(
        await write(keyPair, { ...held, text }),
        text,
        held.token,
      ),
    ).toEqual({ ok: false, error: 'bad-record' })
  })

  it('refuses a record made for another credential id', async () => {
    const { keyPair } = await person()
    const held = await record(keyPair)
    const elsewhere = await record(keyPair)

    // The write names one passkey and the record another, so no passkey the
    // person holds would open what the store filed.
    const signed = await createPasskeyRecordWrite(
      {
        credentialId: held.secret.credentialId,
        record: elsewhere.text,
        challenge: challenge(),
      },
      keyPair,
    )
    expect(
      await store().put(
        encodeSignedStatement(signed),
        elsewhere.text,
        elsewhere.token,
      ),
    ).toEqual({ ok: false, error: 'bad-record' })
  })

  it('refuses a stale or unknown challenge', async () => {
    const { keyPair } = await person()
    const held = await record(keyPair)
    const records = store()
    const value = challenge()

    expect(
      await records.put(
        await write(keyPair, held, value),
        held.text,
        held.token,
      ),
    ).toEqual({ ok: true })
    // The same challenge a second time is no longer issued.
    expect(
      await records.put(
        await write(keyPair, held, value),
        held.text,
        held.token,
      ),
    ).toEqual({ ok: false, error: 'stale-challenge' })
  })

  it('leaves a credential id with the person who claimed it', async () => {
    const first = await person('Ada')
    const second = await person('Grace')
    const held = await record(first.keyPair)
    const records = store()
    await records.put(await write(first.keyPair, held), held.text, held.token)

    // Grace wraps her own key under Ada's credential id.
    const stolen = await wrapPersonKeyWithPasskey(second.keyPair, held.secret)
    const text = backupToFileText(stolen, new Date(clock))
    expect(
      await records.put(
        await write(second.keyPair, { ...held, text }),
        text,
        held.token,
      ),
    ).toEqual({ ok: false, error: 'not-yours' })
  })

  it('caps how many records one person keeps', async () => {
    const { keyPair } = await person()
    const records = store()
    for (let index = 0; index < MAX_RECORDS_PER_PERSON; index++) {
      const held = await record(keyPair)
      expect(
        await records.put(await write(keyPair, held), held.text, held.token),
      ).toEqual({ ok: true })
    }
    const extra = await record(keyPair)
    expect(
      await records.put(await write(keyPair, extra), extra.text, extra.token),
    ).toEqual({ ok: false, error: 'too-many-records' })
  })

  it('refuses a body that is not a signed write', async () => {
    expect(await store().put('not-a-statement', 'record', 'token')).toEqual({
      ok: false,
      error: 'malformed',
    })
  })
})

describe('fetching a record', () => {
  it('hands it to whoever holds the passkey', async () => {
    const { keyPair } = await person()
    const held = await record(keyPair)
    const records = store()
    await records.put(await write(keyPair, held), held.text, held.token)

    expect(await records.fetch(held.secret.credentialId, held.token)).toEqual({
      ok: true,
      record: held.text,
    })
  })

  it('answers the same for a wrong token and an unknown credential', async () => {
    const { keyPair } = await person()
    const held = await record(keyPair)
    const records = store()
    await records.put(await write(keyPair, held), held.text, held.token)

    const wrongToken = await records.fetch(
      held.secret.credentialId,
      await personKeyServiceToken(crypto.getRandomValues(new Uint8Array(32))),
    )
    const unknown = await records.fetch('AAAA', held.token)
    expect(wrongToken).toEqual({ ok: false, error: 'no-record' })
    expect(unknown).toEqual(wrongToken)
  })

  it('throttles repeated tries for one credential id', async () => {
    const { keyPair } = await person()
    const held = await record(keyPair)
    const records = store()
    await records.put(await write(keyPair, held), held.text, held.token)

    for (let index = 0; index < MAX_FETCHES_PER_WINDOW; index++) {
      expect(
        (await records.fetch(held.secret.credentialId, held.token)).ok,
      ).toBe(true)
    }
    expect(await records.fetch(held.secret.credentialId, held.token)).toEqual({
      ok: false,
      error: 'no-record',
    })

    // The window passes and the real owner is let through again.
    clock += FETCH_WINDOW_MS
    expect((await records.fetch(held.secret.credentialId, held.token)).ok).toBe(
      true,
    )
  })
})
