import { describe, expect, it, vi } from 'vitest'
import type { HostSession } from '@/hostSession'
import { GetCurrentSessionChannel } from './GetCurrentSessionChannel'
import { StartSessionChannel } from './StartSessionChannel'
import { StopSessionChannel } from './StopSessionChannel'

vi.mock('@/syncServer', () => ({ hostSession: {} }))

const SESSION = {
  sessionId: 'session-1',
  startedAt: '2026-10-16T10:00:00.000Z',
}

const CLOSED = {
  sessionId: 'session-1',
  signsAt: '2026-10-16T10:01:00.000Z',
}

function fakeSession(overrides: Partial<HostSession> = {}): HostSession {
  return {
    start: vi.fn(async () => SESSION),
    stop: vi.fn(async () => CLOSED),
    current: vi.fn(() => SESSION),
    clearStale: vi.fn(async () => {}),
    onSettled: vi.fn(() => () => {}),
    ...overrides,
  }
}

describe('the session channels', () => {
  it('starts a session on the given doc', async () => {
    const session = fakeSession()

    const response = await new StartSessionChannel(session).handle({
      data: { docUrl: 'automerge:root' },
    })

    expect(session.start).toHaveBeenCalledWith('automerge:root')
    expect(response).toEqual({ success: true, data: { session: SESSION } })
  })

  it('answers a failed start with the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = fakeSession({
      start: async () => {
        throw new Error('Session session-1 is already open')
      },
    })

    const response = await new StartSessionChannel(session).handle({
      data: { docUrl: 'automerge:root' },
    })

    expect(response).toEqual({ success: false, error: expect.any(Error) })
  })

  it('rejects a start without a doc url', async () => {
    await expect(
      new StartSessionChannel(fakeSession()).handle({ data: {} }),
    ).rejects.toThrow('Invalid data')
  })

  it('stops the session', async () => {
    const session = fakeSession()

    const response = await new StopSessionChannel(session).handle()

    expect(session.stop).toHaveBeenCalled()
    expect(response).toEqual({ success: true, data: { closed: CLOSED } })
  })

  it('answers a stop with nothing open with no closed session', async () => {
    const session = fakeSession({ stop: async () => undefined })

    const response = await new StopSessionChannel(session).handle()

    expect(response).toEqual({ success: true, data: {} })
  })

  it('reads the open session', () => {
    expect(new GetCurrentSessionChannel(fakeSession()).handle()).toEqual({
      success: true,
      data: { session: SESSION },
    })
  })
})
