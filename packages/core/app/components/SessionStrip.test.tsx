import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppContextProvider } from '@/context/AppContext'
import { HostConnectionProvider } from '@/context/HostConnectionContext'
import type { HostConnection } from '@/hostConnection'
import type { IpcService, ValidIpcEvent } from '@/IpcService'
import type { RootDocument } from '@/types'
import { SessionStrip } from './SessionStrip'

const T0 = Date.parse('2026-10-16T10:00:00.000Z')
const SESSION = {
  sessionId: '7c41e2b0-1111-4222-8333-444455556666',
  startedAt: new Date(T0).toISOString(),
}

let doc: RootDocument = { recordings: [] }
let isRecording = false

vi.mock('@automerge/automerge-repo-react-hooks', () => ({
  useDocument: () => [doc, vi.fn()],
}))

vi.mock('@/utils', () => ({
  useRequiredAutomergeUrl: () => ({ automergeUrl: 'automerge:root' }),
}))

vi.mock('@/context/RecordingContext', () => ({
  useRecorder: () => ({ isRecording }),
}))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(T0 + 42 * 60_000 + 10_000)
  doc = { recordings: [] }
  isRecording = false
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** A host connection the test turns on and off. */
function fakeConnection(
  connected = false,
  revoked = false,
): HostConnection & {
  setConnected(next: boolean): void
  setRevoked(): void
} {
  const listeners = new Set<() => void>()
  const notify = () => act(() => listeners.forEach((listener) => listener()))
  return {
    isConnected: () => connected,
    isRevoked: () => revoked,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setConnected(next) {
      connected = next
      notify()
    },
    setRevoked() {
      revoked = true
      notify()
    },
  }
}

function renderGuest({ connected = false, revoked = false } = {}) {
  const connection = fakeConnection(connected, revoked)
  const tree = () => (
    <AppContextProvider
      value={{ type: 'web-client', worker: {} as unknown as Worker }}
    >
      <HostConnectionProvider connection={connection}>
        <SessionStrip />
      </HostConnectionProvider>
    </AppContextProvider>
  )
  const view = render(tree())
  // The mocked doc and recorder are plain variables, so a change needs this.
  const refresh = () => view.rerender(tree())
  return { connection, refresh }
}

const strip = () => screen.getByRole('status')

describe('the guest session indicator', () => {
  it('shows nothing on a web client with no host', () => {
    render(
      <AppContextProvider
        value={{ type: 'web-client', worker: {} as unknown as Worker }}
      >
        <SessionStrip />
      </AppContextProvider>,
    )

    expect(screen.queryByRole('status')).toBeNull()
  })

  // A refused socket and a host out of range look the same otherwise, and
  // only one of them is worth waiting out.
  it('says the device is revoked rather than unreachable', () => {
    doc = { recordings: [], session: SESSION }
    const { connection } = renderGuest({ connected: true })

    connection.setRevoked()

    expect(strip()).toHaveTextContent('This device is revoked')
    expect(strip()).toHaveTextContent('the host will not sync with it')
    expect(strip().querySelector('[data-dot]')).toHaveAttribute(
      'data-dot',
      'failed',
    )
  })

  it('says it cannot reach the host while offline, whatever the doc says', () => {
    doc = { recordings: [], session: SESSION }
    renderGuest()

    expect(strip()).toHaveTextContent("Can't reach the host")
    expect(strip()).toHaveTextContent('takes have no session')
    expect(strip().querySelector('[data-dot]')).toHaveAttribute(
      'data-dot',
      'unreachable',
    )
  })

  it('shows no session once connected with none open', () => {
    const { connection } = renderGuest()

    connection.setConnected(true)

    expect(strip()).toHaveTextContent('No session')
    expect(strip()).toHaveTextContent('takes recorded now have no session')
  })

  it('shows the open session and how long it has been open', () => {
    doc = { recordings: [], session: SESSION }
    renderGuest({ connected: true })

    expect(strip()).toHaveTextContent('Session 7c41·e2b0')
    expect(strip()).toHaveTextContent('open 42:10')
    expect(strip().querySelector('[data-dot]')).toHaveAttribute(
      'data-dot',
      'open',
    )
  })

  it('follows the doc as the host starts and stops', () => {
    const { refresh } = renderGuest({ connected: true })

    doc = { recordings: [], session: SESSION }
    refresh()
    expect(strip()).toHaveTextContent('Session 7c41·e2b0')

    doc = { recordings: [] }
    refresh()
    expect(strip()).toHaveTextContent('No session')
  })

  it('goes offline when the host drops', () => {
    doc = { recordings: [], session: SESSION }
    const { connection } = renderGuest({ connected: true })

    connection.setConnected(false)

    expect(strip()).toHaveTextContent("Can't reach the host")
  })

  it('keeps a take in the session it started in after a stop', () => {
    doc = { recordings: [], session: SESSION }
    const { refresh } = renderGuest({ connected: true })

    isRecording = true
    refresh()
    expect(strip()).toHaveTextContent('Session 7c41·e2b0')
    expect(strip()).toHaveTextContent('this take is in it')

    doc = { recordings: [] }
    refresh()
    expect(strip()).toHaveTextContent('Session 7c41·e2b0 stopped')
    expect(strip()).toHaveTextContent('this take stays in it')
  })

  it('does not put a take into a session opened after it started', () => {
    const { refresh } = renderGuest({ connected: true })

    isRecording = true
    refresh()
    doc = { recordings: [], session: SESSION }
    refresh()

    expect(strip()).toHaveTextContent('this take has no session')
  })

  it('records an offline take with no session', () => {
    doc = { recordings: [], session: SESSION }
    const { refresh } = renderGuest()

    isRecording = true
    refresh()

    expect(strip()).toHaveTextContent("Can't reach the host")
    expect(strip()).toHaveTextContent('this take has no session')
  })
})

/** An IPC service answering the session channels from in-memory state. */
function fakeIpc({
  running = true,
  open,
}: { running?: boolean; open?: typeof SESSION } = {}) {
  let session = open
  const listeners = new Map<ValidIpcEvent, (payload: unknown) => void>()
  const send = vi.fn(async (channel: string) => {
    switch (channel) {
      case 'sync:get-server-info':
        return { running, url: 'ws://127.0.0.1:433' }
      case 'session:get-current':
        return { success: true, data: { session } }
      case 'session:start':
        session = SESSION
        return { success: true, data: { session } }
      case 'session:stop': {
        const closed = session && {
          sessionId: session.sessionId,
          signsAt: new Date(Date.now() + 60_000).toISOString(),
        }
        session = undefined
        return { success: true, data: closed ? { closed } : {} }
      }
    }
    throw new Error(`Unexpected channel ${channel}`)
  })
  const ipc = {
    send,
    subscribe: (event: ValidIpcEvent, listener: (payload: unknown) => void) => {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
  } as unknown as IpcService
  const emit = (event: ValidIpcEvent, payload: unknown) =>
    act(() => listeners.get(event)?.(payload))
  return { ipc, send, emit }
}

function renderHost(ipc: IpcService) {
  return render(
    <AppContextProvider value={{ type: 'electron-client', ipc }}>
      <SessionStrip />
    </AppContextProvider>,
  )
}

describe('the host session control', () => {
  it('starts a session on the root doc', async () => {
    const { ipc, send } = fakeIpc()
    renderHost(ipc)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const start = await screen.findByRole('button', { name: 'Start session' })
    await vi.waitFor(() => expect(start).toBeEnabled())
    expect(strip()).toHaveTextContent('takes have no session')

    await user.click(start)

    expect(send).toHaveBeenCalledWith('session:start', {
      data: { docUrl: 'automerge:root' },
    })
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeVisible()
    expect(strip()).toHaveTextContent('Session 7c41·e2b0')
    expect(strip()).toHaveTextContent('open 42:10')
  })

  it('shows a session that was already open on mount', async () => {
    const { ipc } = fakeIpc({ open: SESSION })
    renderHost(ipc)

    expect(await screen.findByRole('button', { name: 'Stop' })).toBeVisible()
    expect(strip()).toHaveTextContent('open 42:10')
  })

  it('counts down to signing after a stop, then shows the result', async () => {
    const { ipc, emit } = fakeIpc({ open: SESSION })
    renderHost(ipc)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(await screen.findByRole('button', { name: 'Stop' }))

    expect(
      await screen.findByRole('button', { name: 'Start session' }),
    ).toBeVisible()
    expect(strip()).toHaveTextContent('No session')
    expect(strip()).toHaveTextContent('7c41·e2b0 signs in 1:00')

    emit('session:settled', {
      sessionId: SESSION.sessionId,
      signedAt: new Date(Date.now() + 60_000).toISOString(),
    })
    expect(strip()).toHaveTextContent(/7c41·e2b0 signed at \d\d:\d\d/)
  })

  it('says when a record could not be signed', async () => {
    const { ipc, emit } = fakeIpc({ open: SESSION })
    renderHost(ipc)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    await screen.findByRole('button', { name: 'Start session' })

    emit('session:settled', { sessionId: SESSION.sessionId })

    expect(strip()).toHaveTextContent('7c41·e2b0 could not be signed')
    expect(strip().querySelector('[data-dot]')).toHaveAttribute(
      'data-dot',
      'failed',
    )
  })

  it('disables start while the sync server is off', async () => {
    const { ipc } = fakeIpc({ running: false })
    renderHost(ipc)

    expect(await screen.findByText('the sync server is off')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled()
  })
})
