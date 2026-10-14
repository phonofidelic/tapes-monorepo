import { describe, expect, it } from 'vitest'
import { checkSessionRecord, createSessionRecord } from './sessionRecord'
import { exportPublicKey, generateSigningKeyPair, signStatement } from './signing'
import { SESSION_RECORD_TYPE } from './types'

const details = {
  sessionId: 'session-1',
  openedAt: new Date('2026-10-14T10:00:00.000Z'),
  closedAt: new Date('2026-10-14T11:00:00.000Z'),
  devices: [
    {
      deviceKey: 'key-b',
      label: 'iPhone · Safari',
      spans: [
        {
          joinedAt: '2026-10-14T10:30:00.000Z',
          leftAt: '2026-10-14T11:00:00.000Z',
        },
        {
          joinedAt: '2026-10-14T10:00:00.000Z',
          leftAt: '2026-10-14T10:10:00.000Z',
        },
      ],
    },
    {
      deviceKey: 'key-a',
      spans: [
        {
          joinedAt: '2026-10-14T10:00:00.000Z',
          leftAt: '2026-10-14T11:00:00.000Z',
        },
      ],
    },
  ],
  claims: ['ff'.repeat(32), 'aa'.repeat(32), 'ff'.repeat(32)],
}

describe('createSessionRecord', () => {
  it('signs a record with sorted devices, spans and claims', async () => {
    const hostKeyPair = await generateSigningKeyPair()

    const record = await createSessionRecord(details, hostKeyPair)

    expect(record.payload).toEqual({
      type: SESSION_RECORD_TYPE,
      sessionId: 'session-1',
      openedAt: '2026-10-14T10:00:00.000Z',
      closedAt: '2026-10-14T11:00:00.000Z',
      devices: [
        details.devices[1],
        {
          ...details.devices[0],
          spans: [details.devices[0].spans[1], details.devices[0].spans[0]],
        },
      ],
      claims: ['aa'.repeat(32), 'ff'.repeat(32)],
      hostKey: await exportPublicKey(hostKeyPair.publicKey),
    })
    expect(await checkSessionRecord(record)).toEqual({ ok: true, record })
  })

  it('does not reorder the caller’s arrays', async () => {
    const devices = structuredClone(details.devices)

    await createSessionRecord(
      { ...details, devices },
      await generateSigningKeyPair(),
    )

    expect(devices).toEqual(details.devices)
  })
})

describe('checkSessionRecord', () => {
  it('rejects a record changed after signing', async () => {
    const record = await createSessionRecord(
      details,
      await generateSigningKeyPair(),
    )
    const tampered = {
      ...record,
      payload: { ...record.payload, claims: [] },
    }

    expect(await checkSessionRecord(tampered)).toEqual({
      ok: false,
      problem: 'bad-signature',
    })
  })

  it('rejects another statement type', async () => {
    const keyPair = await generateSigningKeyPair()
    const other = await signStatement(
      {
        type: 'tapes/receipt@1',
        hostKey: await exportPublicKey(keyPair.publicKey),
      },
      keyPair.privateKey,
    )

    expect(await checkSessionRecord(other)).toEqual({
      ok: false,
      problem: 'malformed',
    })
  })

  it('rejects a device without spans', async () => {
    const keyPair = await generateSigningKeyPair()
    const record = await signStatement(
      {
        type: SESSION_RECORD_TYPE,
        sessionId: 'session-1',
        openedAt: '2026-10-14T10:00:00.000Z',
        closedAt: '2026-10-14T11:00:00.000Z',
        devices: [{ deviceKey: 'key-a' }],
        claims: [],
        hostKey: await exportPublicKey(keyPair.publicKey),
      },
      keyPair.privateKey,
    )

    expect(await checkSessionRecord(record)).toEqual({
      ok: false,
      problem: 'malformed',
    })
  })
})
