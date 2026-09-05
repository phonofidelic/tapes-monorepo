import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlaybackSummary, formatCompletion } from './PlaybackSummary'
import {
  AggregatesProvider,
  useRecordingPlayback,
} from '@/context/AggregatesContext'
import { AppContextProvider } from '@/context/AppContext'
import type { EventHost } from '@/eventTarget'

const RECORDING = 'automerge:2j9knpCseyhnK8izDmiqpZM7bJq'
const OTHER = 'automerge:3xVdEDGkQ8BCcgQrq3Fh8RmxrsFF'
const HOST: EventHost = { kind: 'http', baseUrl: 'http://127.0.0.1:9001' }

const worker = { postMessage: () => {} } as unknown as Worker

/** A host answering with the given rows, or never answering at all. */
function hostAnswering(
  rows: Array<{
    recordingUrl: string
    plays: number
    averageCompletion: number
  }>,
) {
  return () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          aggregates: rows,
          generatedAt: '2026-09-05T10:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
}

/** A fetch that never answers, standing in for a host that is not there. */
const unreachable = () => Promise.reject(new Error('offline'))

function renderRow(
  fetchImpl: () => Promise<Response>,
  target: EventHost | undefined,
) {
  vi.stubGlobal('fetch', fetchImpl)
  return render(
    <AppContextProvider value={{ type: 'web-client', worker }}>
      <AggregatesProvider target={target}>
        <PlaybackSummary recordingUrl={RECORDING} />
      </AggregatesProvider>
    </AppContextProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('formatCompletion', () => {
  it('rounds to whole percent', () => {
    expect(formatCompletion(0.626)).toBe('63%')
    expect(formatCompletion(1)).toBe('100%')
    expect(formatCompletion(0)).toBe('0%')
  })

  it('does not round a play that happened down to zero', () => {
    expect(formatCompletion(0.002)).toBe('<1%')
  })
})

describe('PlaybackSummary', () => {
  it('shows plays and the average once the host answers', async () => {
    renderRow(
      hostAnswering([
        { recordingUrl: RECORDING, plays: 12, averageCompletion: 0.625 },
      ]),
      HOST,
    )

    expect(
      await screen.findByText('12 plays · 63% complete on average'),
    ).toBeInTheDocument()
  })

  it('does not call a single play an average', async () => {
    renderRow(
      hostAnswering([
        { recordingUrl: RECORDING, plays: 1, averageCompletion: 0.4 },
      ]),
      HOST,
    )

    expect(await screen.findByText('1 play · 40% complete')).toBeInTheDocument()
    expect(screen.queryByText(/average/)).not.toBeInTheDocument()
  })

  it('says zero when the host answers without this recording', async () => {
    renderRow(
      hostAnswering([
        { recordingUrl: OTHER, plays: 3, averageCompletion: 0.9 },
      ]),
      HOST,
    )

    expect(await screen.findByText('0 plays')).toBeInTheDocument()
  })

  it('does not show zero when the host cannot be reached', async () => {
    renderRow(unreachable, HOST)

    expect(await screen.findByText('Plays unknown')).toBeInTheDocument()
    // The worst outcome this ticket guards against: a played tape reading as
    // never played because the host is asleep.
    expect(screen.queryByText('0 plays')).not.toBeInTheDocument()
  })

  it('does not show zero when there is no host to ask', () => {
    renderRow(unreachable, undefined)

    expect(screen.getByText('Plays unknown')).toBeInTheDocument()
  })
})

describe('useRecordingPlayback', () => {
  it('treats a row that counts no plays as unplayed', async () => {
    function Probe() {
      const playback = useRecordingPlayback(RECORDING)
      return <span>{playback.status}</span>
    }
    vi.stubGlobal(
      'fetch',
      hostAnswering([
        { recordingUrl: RECORDING, plays: 0, averageCompletion: 0 },
      ]),
    )
    render(
      <AppContextProvider value={{ type: 'web-client', worker }}>
        <AggregatesProvider target={HOST}>
          <Probe />
        </AggregatesProvider>
      </AppContextProvider>,
    )

    expect(await screen.findByText('unplayed')).toBeInTheDocument()
  })
})
