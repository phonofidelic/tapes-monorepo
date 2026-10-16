import { describe, expect, it, vi } from 'vitest'
import type { SessionSettledEvent } from '@tapes-monorepo/core'
import {
  SESSION_SETTLED_EVENT,
  startSessionSettledPush,
} from './sessionSettledPush'

function setup() {
  let emit: (event: SessionSettledEvent) => void = () => {}
  const unsubscribe = vi.fn()
  const session = {
    onSettled: vi.fn((listener: (event: SessionSettledEvent) => void) => {
      emit = listener
      return unsubscribe
    }),
  }
  return { session, unsubscribe, emit: (e: SessionSettledEvent) => emit(e) }
}

const SIGNED = { sessionId: 'session-1', signedAt: '2026-10-16T10:01:00.000Z' }

describe('the settled-session push', () => {
  it('sends each settled session to the current window', () => {
    const { session, emit } = setup()
    const window = { isDestroyed: () => false, send: vi.fn() }
    startSessionSettledPush(session, () => window)

    emit(SIGNED)

    expect(window.send).toHaveBeenCalledWith(SESSION_SETTLED_EVENT, SIGNED)
  })

  it('skips a destroyed window', () => {
    const { session, emit } = setup()
    const window = { isDestroyed: () => true, send: vi.fn() }
    startSessionSettledPush(session, () => window)

    emit(SIGNED)

    expect(window.send).not.toHaveBeenCalled()
  })

  it('returns the unsubscribe', () => {
    const { session, unsubscribe } = setup()

    startSessionSettledPush(session, () => null)()

    expect(unsubscribe).toHaveBeenCalled()
  })
})
