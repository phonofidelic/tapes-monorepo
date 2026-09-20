import { describe, it, expect, vi } from 'vitest'
import { StopRecordingChannel } from './StopRecordingChannel'
import type { SoxRecorder } from './soxRecorder'

/**
 * The renderer awaits this channel inside a click handler with no catch, and
 * it has already left its recording state by the time the answer arrives. Both
 * outcomes have to be answers.
 */

const channelWith = (stop: () => Promise<string>) =>
  new StopRecordingChannel({ stop } as unknown as SoxRecorder)

describe('stopping a recording', () => {
  it('answers with the file sox wrote', async () => {
    const channel = channelWith(() => Promise.resolve('/tapes/take-one.wav'))

    await expect(channel.handle()).resolves.toEqual({
      success: true,
      data: { filepath: '/tapes/take-one.wav' },
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
    const stop = vi.fn(() => Promise.resolve('/tapes/take-one.wav'))

    await expect(channelWith(stop).handle()).resolves.toMatchObject({
      success: true,
    })
    expect(stop).toHaveBeenCalled()
  })
})
