import { createHash } from 'crypto'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { describe, it, expect, vi } from 'vitest'
import {
  decodeSignedStatement,
  exportPublicKey,
  generateSigningKeyPair,
  verifyStatement,
  type RecordingClaim,
  type Signed,
} from '@tapes-monorepo/provenance'
import { StopRecordingChannel } from './StopRecordingChannel'
import type { RecordedTake, SoxRecorder } from './soxRecorder'

vi.mock('electron', () => ({ app: {}, safeStorage: {} }))

/**
 * The renderer awaits this channel inside a click handler with no catch, and
 * it has already left its recording state by the time the answer arrives. Both
 * outcomes have to be answers.
 */

const startedAt = '2026-10-05T12:00:00.000Z'
const endedAt = '2026-10-05T12:03:00.000Z'

/** A take whose file really exists, so the channel can hash it. */
const recordedTake = (contents = 'recorded audio'): RecordedTake => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tapes-stop-'))
  const filepath = path.join(dir, 'take-one.wav')
  writeFileSync(filepath, contents)
  return { filepath, startedAt, endedAt }
}

const channelWith = (
  stop: () => Promise<RecordedTake>,
  loadSigningKey: () => Promise<CryptoKeyPair> = generateSigningKeyPair,
) =>
  new StopRecordingChannel({ stop } as unknown as SoxRecorder, loadSigningKey)

describe('stopping a recording', () => {
  it('answers with the file sox wrote and a claim signed over it', async () => {
    const take = recordedTake('recorded audio')
    const keyPair = await generateSigningKeyPair()
    const channel = channelWith(
      () => Promise.resolve(take),
      () => Promise.resolve(keyPair),
    )

    const response = await channel.handle()

    if (!response.success) {
      throw response.error
    }
    expect(response.data.filepath).toBe(take.filepath)
    const signed = decodeSignedStatement(
      response.data.claim!,
    ) as Signed<RecordingClaim>
    expect(signed.payload).toMatchObject({
      blob: {
        hash: createHash('sha256').update('recorded audio').digest('hex'),
        size: 'recorded audio'.length,
        mimeType: 'audio/wav',
      },
      startedAt,
      endedAt,
      deviceKey: await exportPublicKey(keyPair.publicKey),
    })
    expect(await verifyStatement(signed, keyPair.publicKey)).toBe(true)
  })

  it('still answers with the file when it cannot sign', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const take = recordedTake()
    const channel = channelWith(
      () => Promise.resolve(take),
      () => Promise.reject(new Error('safeStorage unavailable')),
    )

    await expect(channel.handle()).resolves.toEqual({
      success: true,
      data: { filepath: take.filepath, claim: undefined },
    })
  })

  it('answers with a failure when sox could not be ended', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const channel = channelWith(() =>
      Promise.reject(new Error('No recording is in progress')),
    )

    const response = await channel.handle()

    expect(response.success).toBe(false)
    expect(response).toHaveProperty(
      'error.message',
      'No recording is in progress',
    )
  })

  // It used to demand a storage location and an elapsed time, then read
  // neither. Clearing the storage location mid-recording made every stop
  // invalid, and the rejection left sox running with nothing able to reach it.
  it('reads nothing off the request', async () => {
    const stop = vi.fn(() => Promise.resolve(recordedTake()))

    await expect(channelWith(stop).handle()).resolves.toMatchObject({
      success: true,
    })
    expect(stop).toHaveBeenCalled()
  })
})
