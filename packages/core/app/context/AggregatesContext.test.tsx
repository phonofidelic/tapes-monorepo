import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AggregatesProvider, useAggregates } from './AggregatesContext'
import { AppContextProvider } from './AppContext'
import type { EventHost } from '@/eventTarget'

const RECORDING = 'automerge:2j9knpCseyhnK8izDmiqpZM7bJq'
const HOST: EventHost = {
  kind: 'http',
  baseUrl: 'http://127.0.0.1:9001',
  token: 'pair-token',
}
const OTHER_HOST: EventHost = {
  kind: 'http',
  baseUrl: 'http://studio.local:9001',
  token: 'other-token',
}

const worker = { postMessage: () => {} } as unknown as Worker

function snapshot(plays: number, etag: string) {
  return new Response(
    JSON.stringify({
      aggregates: [{ recordingUrl: RECORDING, plays, averageCompletion: 0.5 }],
      generatedAt: '2026-09-05T10:00:00.000Z',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ETag: etag },
    },
  )
}

/** Renders the numbers as text, plus a button per way of asking again. */
function Probe() {
  const { byRecording, refresh } = useAggregates()
  const plays = byRecording.get(RECORDING)?.plays
  return (
    <div>
      <span data-testid="plays">{plays ?? 'none'}</span>
      <button onClick={() => refresh()}>refresh</button>
      <button onClick={() => refresh({ force: true })}>force</button>
    </div>
  )
}

function renderWith(target: EventHost | undefined) {
  return render(
    <AppContextProvider value={{ type: 'web-client', worker }}>
      <AggregatesProvider target={target}>
        <Probe />
      </AggregatesProvider>
    </AppContextProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AggregatesProvider', () => {
  it('reads the host once and shares the answer with every row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(snapshot(3, '"a"'))
    vi.stubGlobal('fetch', fetchMock)

    renderWith(HOST)

    await waitFor(() =>
      expect(screen.getByTestId('plays')).toHaveTextContent('3'),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // Nothing waits on these numbers: the row is on screen before the host has
  // answered, and gains its count afterwards.
  it('renders before the host answers', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )

    renderWith(HOST)

    expect(screen.getByTestId('plays')).toHaveTextContent('none')
  })

  it('serves a repeat read from the cache within the TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(snapshot(3, '"a"'))
    vi.stubGlobal('fetch', fetchMock)
    renderWith(HOST)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByText('refresh'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // A play that just landed makes the held snapshot wrong rather than merely
  // old, so the TTL is not the thing standing in its way.
  it('re-reads within the TTL when the caller forces it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(snapshot(3, '"a"'))
      .mockResolvedValueOnce(snapshot(4, '"b"'))
    vi.stubGlobal('fetch', fetchMock)
    renderWith(HOST)
    await waitFor(() =>
      expect(screen.getByTestId('plays')).toHaveTextContent('3'),
    )

    await userEvent.click(screen.getByText('force'))

    await waitFor(() =>
      expect(screen.getByTestId('plays')).toHaveTextContent('4'),
    )
  })

  // Reconnecting is when the held numbers are most likely to be wrong: the
  // device has been away, and other people have been playing tapes.
  it('revalidates on reconnect', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(snapshot(3, '"a"'))
      .mockResolvedValueOnce(snapshot(9, '"b"'))
    vi.stubGlobal('fetch', fetchMock)
    renderWith(HOST)
    await waitFor(() =>
      expect(screen.getByTestId('plays')).toHaveTextContent('3'),
    )

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() =>
      expect(screen.getByTestId('plays')).toHaveTextContent('9'),
    )
  })

  // A `304` is the host saying the held numbers are still current, which is
  // the whole answer — there is nothing to apply.
  it('keeps the held snapshot when the host reports it unchanged', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(snapshot(3, '"a"'))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    vi.stubGlobal('fetch', fetchMock)
    renderWith(HOST)
    await waitFor(() =>
      expect(screen.getByTestId('plays')).toHaveTextContent('3'),
    )

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(screen.getByTestId('plays')).toHaveTextContent('3')
  })

  // Stale counts beside a host that is briefly away beat a list that empties
  // itself whenever the network hiccups.
  it('keeps the numbers it has when a re-read fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(snapshot(3, '"a"'))
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    renderWith(HOST)
    await waitFor(() =>
      expect(screen.getByTestId('plays')).toHaveTextContent('3'),
    )

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(screen.getByTestId('plays')).toHaveTextContent('3')
  })

  // Another host's numbers are a different library's. Revalidating the old
  // host's tag against the new one would be meaningless, and showing the old
  // counts under the new host would be wrong.
  it('drops what it holds when the host changes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(snapshot(3, '"a"'))
      .mockImplementationOnce(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = renderWith(HOST)
    await waitFor(() =>
      expect(screen.getByTestId('plays')).toHaveTextContent('3'),
    )

    rerender(
      <AppContextProvider value={{ type: 'web-client', worker }}>
        <AggregatesProvider target={OTHER_HOST}>
          <Probe />
        </AggregatesProvider>
      </AppContextProvider>,
    )

    expect(screen.getByTestId('plays')).toHaveTextContent('none')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toContain('studio.local')
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty(
      'If-None-Match',
    )
  })

  // A standalone client is paired with nothing, which is a list without
  // numbers rather than an error to clear.
  it('asks nobody when there is no host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(snapshot(3, '"a"'))
    vi.stubGlobal('fetch', fetchMock)

    renderWith(undefined)

    expect(screen.getByTestId('plays')).toHaveTextContent('none')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
