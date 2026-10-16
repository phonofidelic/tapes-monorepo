import path from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkSessionRecord,
  exportPublicKey,
  generateSigningKeyPair,
  type RecordingClaim,
  type SessionRecord,
  type Signed,
} from '@tapes-monorepo/provenance'
import { createBlobStore, type BlobStore } from './blobStore'
import { createSessionRecorder } from './sessionRecorder'
import { readStoredStatement } from './statementUpload'
import type { SyncConnection } from './syncConnections'

const DOC_URL = 'automerge:root'
const T0 = Date.parse('2026-10-14T10:00:00.000Z')
const minutes = (n: number) => T0 + n * 60_000
const iso = (n: number) => new Date(minutes(n)).toISOString()

let root: string
let store: BlobStore
let hostKeyPair: CryptoKeyPair
let clock: number

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tapes-sessions-'))
  store = createBlobStore(root)
  hostKeyPair = await generateSigningKeyPair()
  clock = T0
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function connection(
  id: string,
  details: Partial<SyncConnection> = {},
): SyncConnection {
  return { id, connectedAt: clock, self: false, ...details }
}

function claim(sessionId: string): RecordingClaim {
  return { sessionId } as RecordingClaim
}

/** A recorder whose grace periods end only when the test says so. */
function setup(
  connections: SyncConnection[] = [],
  onSigned?: Parameters<typeof createSessionRecorder>[0]['onSigned'],
) {
  let endGrace = () => {}
  const recorder = createSessionRecorder({
    loadSigningKey: async () => hostKeyPair,
    getStore: () => store,
    getConnections: () => connections,
    onSigned,
    now: () => clock,
    wait: () =>
      new Promise((resolve) => {
        endGrace = resolve
      }),
  })
  return { recorder, endGrace: () => endGrace() }
}

async function readRecord(hash: string | undefined) {
  expect(hash).toBeDefined()
  const stored = await readStoredStatement(store, hash!)
  const check = await checkSessionRecord(stored!)
  expect(check.ok).toBe(true)
  return (stored as Signed<SessionRecord>).payload
}

describe('createSessionRecorder', () => {
  it('signs a record of proven devices and their spans', async () => {
    const host = connection('c1', {
      deviceKey: 'host-key',
      self: true,
      connectedAt: minutes(-30),
    })
    const { recorder } = setup([host])

    recorder.open({ sessionId: 'session-1', docUrl: DOC_URL })
    clock = minutes(5)
    const phone = connection('c2', { deviceKey: 'phone-key', label: 'Phone' })
    const unproven = connection('c3', { label: 'Laptop' })
    recorder.connectionsChanged([host, phone, unproven])
    clock = minutes(10)
    recorder.connectionsChanged([host, unproven])
    clock = minutes(20)
    const rejoined = connection('c4', { deviceKey: 'phone-key', label: 'Mine' })
    recorder.connectionsChanged([host, unproven, rejoined])
    clock = minutes(60)

    const record = await readRecord(await recorder.close({ graceMs: 0 }))

    expect(record).toEqual({
      type: 'tapes/session@1',
      sessionId: 'session-1',
      openedAt: iso(0),
      closedAt: iso(60),
      devices: [
        // Already connected at the open, so the span starts there.
        {
          deviceKey: 'host-key',
          spans: [{ joinedAt: iso(0), leftAt: iso(60) }],
        },
        {
          deviceKey: 'phone-key',
          label: 'Mine',
          spans: [
            { joinedAt: iso(5), leftAt: iso(10) },
            { joinedAt: iso(20), leftAt: iso(60) },
          ],
        },
      ],
      claims: [],
      hostKey: await exportPublicKey(hostKeyPair.publicKey),
    })
  })

  it('stores the record owned by the root document', async () => {
    const { recorder } = setup()
    recorder.open({ sessionId: 'session-1', docUrl: DOC_URL })

    const hash = await recorder.close({ graceMs: 0 })

    expect(await store.refs(hash!)).toEqual([DOC_URL])
  })

  it('lists claims for this session, including ones in the grace period', async () => {
    const { recorder, endGrace } = setup()
    recorder.open({ sessionId: 'session-1', docUrl: DOC_URL })
    recorder.claimVerified(claim('session-1'), 'aa'.repeat(32))
    recorder.claimVerified(claim('another-session'), 'bb'.repeat(32))

    const closed = recorder.close()
    recorder.claimVerified(claim('session-1'), 'cc'.repeat(32))
    endGrace()
    const record = await readRecord(await closed)
    recorder.claimVerified(claim('session-1'), 'dd'.repeat(32))

    expect(record.claims).toEqual(['aa'.repeat(32), 'cc'.repeat(32)])
  })

  it('stops following connections at the close', async () => {
    const { recorder, endGrace } = setup()
    recorder.open({ sessionId: 'session-1', docUrl: DOC_URL })

    const closed = recorder.close()
    recorder.connectionsChanged([connection('c1', { deviceKey: 'late-key' })])
    endGrace()

    expect((await readRecord(await closed)).devices).toEqual([])
  })

  it('refuses a second open while one is open', () => {
    const { recorder } = setup()
    recorder.open({ sessionId: 'session-1', docUrl: DOC_URL })

    expect(() =>
      recorder.open({ sessionId: 'session-2', docUrl: DOC_URL }),
    ).toThrow('already open')
    expect(recorder.current()).toEqual({
      sessionId: 'session-1',
      openedAt: T0,
    })
  })

  it('opens a new session while the last one is in its grace period', async () => {
    const { recorder, endGrace } = setup()
    recorder.open({ sessionId: 'session-1', docUrl: DOC_URL })
    const closed = recorder.close()

    recorder.open({ sessionId: 'session-2', docUrl: DOC_URL })
    recorder.claimVerified(claim('session-1'), 'aa'.repeat(32))
    endGrace()

    expect((await readRecord(await closed)).claims).toEqual(['aa'.repeat(32)])
    expect(recorder.current()?.sessionId).toBe('session-2')
  })

  it('signs everything at once on flush', async () => {
    const { recorder } = setup()
    recorder.open({ sessionId: 'session-1', docUrl: DOC_URL })
    const first = recorder.close()
    recorder.open({ sessionId: 'session-2', docUrl: DOC_URL })

    await recorder.flush()

    expect(await first).toBeDefined()
    expect(recorder.current()).toBeUndefined()
    expect((await store.listObjects()).length).toBe(2)
  })

  it('hands the stored record to be listed on its recordings', async () => {
    const onSigned = vi.fn(async () => {})
    const { recorder } = setup([], onSigned)
    recorder.open({ sessionId: 'session-1', docUrl: DOC_URL })
    recorder.claimVerified(claim('session-1'), 'aa'.repeat(32))

    const hash = await recorder.close({ graceMs: 0 })

    expect(onSigned).toHaveBeenCalledWith({
      docUrl: DOC_URL,
      recordHash: hash,
      claims: ['aa'.repeat(32)],
    })
  })

  it('keeps the record when it cannot be listed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { recorder } = setup([], async () => {
      throw new Error('no repo')
    })
    recorder.open({ sessionId: 'session-1', docUrl: DOC_URL })

    await readRecord(await recorder.close({ graceMs: 0 }))
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('resolves undefined when there is nothing to close', async () => {
    expect(await setup().recorder.close()).toBeUndefined()
  })

  it('resolves undefined when the record cannot be stored', async () => {
    const recorder = createSessionRecorder({
      loadSigningKey: async () => hostKeyPair,
      getStore: () => undefined,
      getConnections: () => [],
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    recorder.open({ sessionId: 'session-1', docUrl: DOC_URL })

    expect(await recorder.close({ graceMs: 0 })).toBeUndefined()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
