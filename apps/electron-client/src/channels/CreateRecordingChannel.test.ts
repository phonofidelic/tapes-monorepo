import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { describe, it, expect, vi } from 'vitest'
import {
  decodeSignedStatement,
  generateSigningKeyPair,
  NO_SESSION_ID,
  type RecordingClaim,
  type Signed,
} from '@tapes-monorepo/provenance'
import type { PublishedSession } from '@tapes-monorepo/core'
import { CreateRecordingChannel } from './CreateRecordingChannel'
import { StopRecordingChannel } from './StopRecordingChannel'
import type { RecordedTake, SoxRecorder } from './soxRecorder'

vi.mock('electron', () => ({ app: {}, safeStorage: {} }))
vi.mock('@/syncServer', () => ({ hostSession: {} }))

/**
 * A take's claim names the host session open when it started, through the
 * start and stop channels together.
 */

const startData = {
  storageLocation: '/tapes/recordings',
  audioChannelCount: 1,
  audioFormat: 'wav',
}

/** Keeps what `start` was given and hands it back as the take, like sox. */
function fakeRecorder() {
  let started: { sessionId?: string } | undefined
  return {
    start: async (options: { sessionId?: string }) => {
      started = options
    },
    stop: async (): Promise<RecordedTake> => {
      const dir = mkdtempSync(path.join(tmpdir(), 'tapes-start-'))
      const filepath = path.join(dir, 'take.wav')
      writeFileSync(filepath, 'recorded audio')
      return {
        filepath,
        startedAt: '2026-10-16T09:00:00.000Z',
        endedAt: '2026-10-16T09:03:00.000Z',
        sessionId: started?.sessionId,
      }
    },
  } as unknown as SoxRecorder
}

/** Records one take and returns the session ID its claim signed. */
async function signedSessionId(
  current: () => PublishedSession | undefined,
  between: () => void = () => {},
) {
  const recorder = fakeRecorder()
  const start = new CreateRecordingChannel(recorder, { current })
  const stop = new StopRecordingChannel(recorder, generateSigningKeyPair)

  expect(await start.handle({ data: startData })).toEqual({ success: true })
  between()
  const response = await stop.handle()

  if (!response.success) {
    throw response.error
  }
  const signed = decodeSignedStatement(
    response.data.claim!,
  ) as Signed<RecordingClaim>
  return signed.payload.sessionId
}

const session: PublishedSession = {
  sessionId: 'session-1',
  startedAt: '2026-10-16T08:00:00.000Z',
}

describe('the session a recording claim signs', () => {
  it('is the session open when the take started', async () => {
    expect(await signedSessionId(() => session)).toBe('session-1')
  })

  it('stays the starting session when the take stops after it closes', async () => {
    let open: PublishedSession | undefined = session

    const sessionId = await signedSessionId(
      () => open,
      () => {
        open = undefined
      },
    )

    expect(sessionId).toBe('session-1')
  })

  it('is the placeholder when no session is open', async () => {
    expect(await signedSessionId(() => undefined)).toBe(NO_SESSION_ID)
  })
})
