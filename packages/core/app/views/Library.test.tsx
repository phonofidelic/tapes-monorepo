import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import { AppContextProvider, type AppContextValue } from '@/context/AppContext'
import { BlobProvider } from '@/context/BlobContext'
import { PinProvider } from '@/context/PinContext'
import { PortalContainer, PortalsProvider } from '@/context/PortalsContext'
import type { BlobEndpoint } from '@/blobClient'
import type { IpcService } from '@/IpcService'
import type { Recording, RootDocument } from '@/types'
import { AggregatesProvider } from '@/context/AggregatesContext'
import {
  createHostReceipt,
  createRecordingClaim,
  createSessionRecord,
  exportPublicKey,
  generateSigningKeyPair,
  keyFingerprint,
  statementAddress,
  statementBytes,
  type Signed,
} from '@tapes-monorepo/provenance'
import { clearStatementCache } from '@/recordingProvenance'
import { Library } from './Library'

const REPO_URL = 'automerge:repo' as AutomergeUrl
const RECORDING_URL = 'automerge:recording' as AutomergeUrl

const HASH = 'a'.repeat(64)
const ENDPOINT: BlobEndpoint = {
  baseUrl: 'http://127.0.0.1:9001',
  token: 'pair-token',
}

/** This device's own embedded host: the bytes are already on its disk. */
const LOCAL_ENDPOINT: BlobEndpoint = {
  baseUrl: 'http://127.0.0.1:9001',
  token: 'host-token',
  local: true,
}

/** A server the desktop app syncs with but does not host. */
const REMOTE_ENDPOINT: BlobEndpoint = {
  baseUrl: 'https://sync.example.com',
  token: 'pair-token',
}

const baseRecording: Recording = {
  url: RECORDING_URL,
  filename: 'take-one.wav',
  filepath: '/recordings/take-one.wav',
  name: 'Take one',
  duration: 4,
  id: 'take-one',
}

// Reassigned per test so the mocked useDocument can serve different shapes.
let recording: Recording = baseRecording

const withBlob = (): Recording => ({
  ...baseRecording,
  blob: { hash: HASH, size: 1024, mimeType: 'audio/wav', ext: '.wav' },
})

const webContext: AppContextValue = {
  type: 'web-client',
  worker: {} as unknown as Worker,
}

const electronContext = (send = vi.fn()): AppContextValue => ({
  type: 'electron-client',
  ipc: { send } as unknown as IpcService,
})

/**
 * A storage worker that answers every request successfully, echoing the
 * request id core's callWorker tags messages with. Enough for the cache writes
 * that pinning performs; the OPFS behaviour itself is the worker's own.
 */
const respondingWorker = (): Worker => {
  const postMessage = vi.fn()
  return {
    postMessage,
    addEventListener: (
      _type: string,
      listener: (event: MessageEvent) => void,
    ) => {
      queueMicrotask(() => {
        const sent = postMessage.mock.calls.at(-1)?.[0]
        listener(
          new MessageEvent('message', {
            data: {
              type: `${sent?.type}:response`,
              requestId: sent?.payload?.requestId,
              success: true,
              payload: {},
            },
          }),
        )
      })
    },
    removeEventListener: vi.fn(),
  } as unknown as Worker
}

// isValidAutomergeUrl gates whether Library passes the url to useDocument; the
// stub urls above aren't real Automerge urls, so force it true.
vi.mock('@automerge/automerge-repo', () => ({
  isValidAutomergeUrl: () => true,
}))

// Shared by both call sites (Library + LibraryListItem) so a test can assert
// that nothing wrote to the synced document.
const changeDocument = vi.fn()

// One repo doc holding a single recording, and the recording doc itself.
// Branch on the url so both call sites resolve.
vi.mock('@automerge/automerge-repo-react-hooks', () => ({
  useDocument: (url?: AutomergeUrl) => {
    if (url === REPO_URL) {
      return [{ recordings: [RECORDING_URL] } as RootDocument, changeDocument]
    }
    return [recording, changeDocument]
  },
}))

// The key this device signs with, as its backend reports it. Undefined unless
// a test sets it.
let localDeviceKey: string | undefined
vi.mock('@/localDeviceKey', () => ({
  readLocalDeviceKey: () => Promise.resolve(localDeviceKey),
}))

vi.mock('@/utils', () => ({
  useRequiredAutomergeUrl: () => ({ automergeUrl: REPO_URL }),
}))

vi.mock('@/context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({
    currentUrl: undefined,
    setCurrentSource: vi.fn(),
    setCurrentUrl: vi.fn(),
    setIsPlaying: vi.fn(),
  }),
}))

const renderLibrary = (
  appContext: AppContextValue = webContext,
  endpoints: readonly BlobEndpoint[] = [],
) =>
  render(
    <AppContextProvider value={appContext}>
      <BlobProvider endpoints={endpoints}>
        <PinProvider>
          <PortalsProvider>
            <div data-testid="editor-slot">
              <PortalContainer containerRefKey="editorPortal" />
            </div>
            <Library />
          </PortalsProvider>
        </PinProvider>
      </BlobProvider>
    </AppContextProvider>,
  )

describe('LibraryListItem controls visibility (touch vs mouse)', () => {
  beforeEach(() => {
    cleanup()
    recording = baseRecording
  })

  // Both controls the fix touched. On a fine-pointer (mouse) screen they stay
  // hidden until hover; on a screen with no fine pointer (touch) they must be
  // visible at rest — which is the bug the fix addresses.
  const controls = ['Options', 'Play recording'] as const

  it.each(controls)(
    'the %s button is forced visible where there is no fine pointer',
    (title) => {
      renderLibrary()
      expect(screen.getByTitle(title)).toHaveClass('pointer-none:opacity-100')
    },
  )

  it.each(controls)(
    'the %s button stays hover-revealed on fine-pointer devices',
    (title) => {
      renderLibrary()
      expect(screen.getByTitle(title)).toHaveClass('pointer-fine:opacity-0')
    },
  )

  it.each(controls)(
    'the %s button carries no unconditional opacity-0 (regression guard)',
    (title) => {
      renderLibrary()
      const classes = screen.getByTitle(title).className.split(/\s+/)
      expect(classes).not.toContain('opacity-0')
    },
  )
})

describe('offline pinning', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    vi.unstubAllGlobals()
    recording = baseRecording
  })

  it('offers no pin control when the recording has no stored audio', async () => {
    renderLibrary(webContext, [ENDPOINT])
    await userEvent.click(screen.getByTitle('Options'))

    expect(screen.queryByText('Keep offline')).not.toBeInTheDocument()
  })

  it('offers no pin control when there is no host to fetch from', async () => {
    recording = withBlob()
    renderLibrary(webContext, [])
    await userEvent.click(screen.getByTitle('Options'))

    expect(screen.queryByText('Keep offline')).not.toBeInTheDocument()
  })

  // Every blob this device can fetch is already permanently on its own disk,
  // so a pin would promise nothing the desktop app doesn't already deliver.
  it('offers no pin control when the only host is this device itself', async () => {
    recording = withBlob()
    renderLibrary(electronContext(), [LOCAL_ENDPOINT])
    await userEvent.click(screen.getByTitle('Options'))

    expect(screen.queryByText('Keep offline')).not.toBeInTheDocument()
  })

  // But a desktop app syncing with a server it does not host can be looking at
  // bytes it does not have, which is a real reason to keep a copy.
  it('offers the pin control on the desktop app when a host other than this one holds the bytes', async () => {
    recording = withBlob()
    renderLibrary(electronContext(), [LOCAL_ENDPOINT, REMOTE_ENDPOINT])
    await userEvent.click(screen.getByTitle('Options'))

    expect(screen.getByText('Keep offline')).toBeInTheDocument()
  })

  it('downloads the audio and records the pin on this device', async () => {
    recording = withBlob()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('audio', { status: 200 })),
    )

    renderLibrary({ type: 'web-client', worker: respondingWorker() }, [
      ENDPOINT,
    ])
    await userEvent.click(screen.getByTitle('Options'))
    await userEvent.click(screen.getByText('Keep offline'))

    await waitFor(() => {
      const pins = JSON.parse(localStorage.getItem('tapes.pins') ?? '{}')
      expect(pins).toHaveProperty(RECORDING_URL)
      expect(pins[RECORDING_URL].hash).toBe(HASH)
    })
  })

  // Pins are a fact about this device, not about the root document. The
  // mocked useDocument hands every caller the same change fn, so if a pin ever
  // wrote to the doc it would show up here.
  it('never writes pin state into the synced document', async () => {
    recording = withBlob()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('audio', { status: 200 })),
    )

    renderLibrary({ type: 'web-client', worker: respondingWorker() }, [
      ENDPOINT,
    ])
    await userEvent.click(screen.getByTitle('Options'))
    await userEvent.click(screen.getByText('Keep offline'))

    await waitFor(() =>
      expect(localStorage.getItem('tapes.pins')).not.toBeNull(),
    )
    expect(changeDocument).not.toHaveBeenCalled()
  })
})

describe('deleting', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    vi.unstubAllGlobals()
    recording = withBlob()
  })

  it('lets a web guest release the host copy of a recording it never made', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    renderLibrary(webContext, [ENDPOINT])
    await userEvent.click(screen.getByTitle('Options'))
    await userEvent.click(screen.getByText('Delete'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain(`/blobs/${HASH}`)
    expect(init.method).toBe('DELETE')
  })

  it('sends the hash alongside the filepath so electron can reclaim the bytes', async () => {
    const send = vi.fn().mockResolvedValue({ success: true })

    renderLibrary(electronContext(send), [LOCAL_ENDPOINT])
    await userEvent.click(screen.getByTitle('Options'))
    await userEvent.click(screen.getByText('Delete'))

    await waitFor(() => expect(send).toHaveBeenCalled())
    expect(send).toHaveBeenCalledWith('storage:delete-recording', {
      data: {
        filepath: '/recordings/take-one.wav',
        hash: HASH,
        statements: [],
        docUrl: RECORDING_URL,
      },
    })
  })

  it('releases the statements along with the audio', async () => {
    const claimHash = 'c'.repeat(64)
    const receiptHash = 'd'.repeat(64)
    recording = { ...withBlob(), statements: [claimHash, receiptHash] }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    renderLibrary(webContext, [ENDPOINT])
    await userEvent.click(screen.getByTitle('Options'))
    await userEvent.click(screen.getByText('Delete'))

    // The row also fetches the statements to check them. Count only deletes.
    const deletes = () =>
      fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      )
    await waitFor(() => expect(deletes()).toHaveLength(3))
    const released = deletes().map(([url]) => url as string)
    expect(released).toEqual([
      expect.stringContaining(`/blobs/${HASH}?`),
      expect.stringContaining(`/blobs/${claimHash}?`),
      expect.stringContaining(`/blobs/${receiptHash}?`),
    ])
  })

  // The IPC delete above reaches only the embedded store, so a desktop app in
  // remote mode would otherwise leave its claim standing on the other host.
  it('also releases the claim on a host the desktop app does not run', async () => {
    const send = vi.fn().mockResolvedValue({ success: true })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    renderLibrary(electronContext(send), [LOCAL_ENDPOINT, REMOTE_ENDPOINT])
    await userEvent.click(screen.getByTitle('Options'))
    await userEvent.click(screen.getByText('Delete'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain(`https://sync.example.com/blobs/${HASH}`)
    expect(init.method).toBe('DELETE')
  })
})

describe('playback numbers on a row', () => {
  beforeEach(() => {
    cleanup()
    recording = baseRecording
    vi.unstubAllGlobals()
  })

  const renderWithHost = (fetchImpl: () => Promise<Response>) => {
    vi.stubGlobal('fetch', fetchImpl)
    return render(
      <AppContextProvider value={webContext}>
        <BlobProvider endpoints={[]}>
          <PinProvider>
            <AggregatesProvider
              target={{ kind: 'http', baseUrl: 'http://127.0.0.1:9001' }}
            >
              <PortalsProvider>
                <Library />
              </PortalsProvider>
            </AggregatesProvider>
          </PinProvider>
        </BlobProvider>
      </AppContextProvider>,
    )
  }

  const answering = (plays: number, averageCompletion: number) => () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          aggregates: [
            { recordingUrl: RECORDING_URL, plays, averageCompletion },
          ],
          generatedAt: '2026-09-05T10:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

  it('shows the numbers next to the duration once the host answers', async () => {
    renderWithHost(answering(12, 0.625))

    expect(
      await screen.findByText('12 plays · 63% complete on average'),
    ).toBeInTheDocument()
  })

  it('shows nothing rather than a zero when no host has answered', () => {
    renderLibrary()

    expect(screen.getByText('Plays unknown')).toBeInTheDocument()
  })
})

// The backdrop behind the name editor. It is a click target, not a control:
// it carries no label of its own and duplicates the editor's own close button,
// so exposing it as a button puts an unnamed stop in the tab order.
describe('the editor backdrop', () => {
  beforeEach(() => {
    recording = baseRecording
    cleanup()
  })

  const openEditor = async () => {
    const user = userEvent.setup()
    renderLibrary()
    // The editor panel carries a field by the same name. The row's control
    // is the button, and its accessible name is the recording's.
    const openControl = screen
      .getAllByTitle('Edit recording name')
      .find((element) => element.tagName === 'BUTTON')!
    await user.click(openControl)
    await screen.findByTitle('Close editor')
    return user
  }

  // The panel sits in App's bottom dock, above the player, rather than
  // floating over the list, so it goes into the slot App registers.
  it('opens the editor panel in the editor slot', async () => {
    await openEditor()

    const slot = screen.getByTestId('editor-slot')
    expect(within(slot).getByTitle('Save changes')).toBeInTheDocument()
  })

  it('is not offered as a control of its own', async () => {
    await openEditor()

    expect(
      screen.queryByRole('button', { name: 'Close editor' }),
    ).not.toBeInTheDocument()
    expect(screen.getByTitle('Close editor')).toBeInTheDocument()
  })

  it('closes the editor when clicked', async () => {
    const user = await openEditor()

    await user.click(screen.getByTitle('Close editor'))

    await waitFor(() =>
      expect(screen.queryByTitle('Close editor')).not.toBeInTheDocument(),
    )
  })

  // Clicking away is the mouse gesture. Escape is the one a keyboard has, and
  // it is the only way out now that the backdrop takes no focus.
  it('closes the editor on Escape', async () => {
    const user = await openEditor()

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByTitle('Close editor')).not.toBeInTheDocument(),
    )
  })
})

// The wording for each provenance state. The statements are really signed and
// really checked. Only the host serving them is faked.
describe('provenance on a row', () => {
  const STARTED_AT = '2026-10-05T12:00:00.000Z'
  const ENDED_AT = '2026-10-05T12:03:00.000Z'
  const RECEIVED_AT = '2026-10-05T12:03:02.000Z'
  const audio = { hash: HASH, size: 1024, mimeType: 'audio/wav' }

  let deviceKeys: CryptoKeyPair
  let hostKeys: CryptoKeyPair

  beforeEach(async () => {
    cleanup()
    clearStatementCache()
    vi.unstubAllGlobals()
    localDeviceKey = undefined
    deviceKeys = await generateSigningKeyPair()
    hostKeys = await generateSigningKeyPair()
  })

  const claimFor = (
    keys: CryptoKeyPair,
    details: { sessionId?: string; blob?: typeof audio } = {},
  ) =>
    createRecordingClaim(
      {
        blob: details.blob ?? audio,
        startedAt: STARTED_AT,
        endedAt: ENDED_AT,
        sessionId: details.sessionId,
      },
      keys,
    )

  /** Serves these statements from the host, and a 404 for anything else. */
  const showRow = async (
    statements: Signed<unknown>[],
    listed: string[] = [],
  ) => {
    const served = new Map<string, Uint8Array>()
    for (const statement of statements) {
      served.set(await statementAddress(statement), statementBytes(statement))
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const hash = String(url).split('/').at(-1) ?? ''
        const bytes = served.get(hash)
        return Promise.resolve(
          bytes
            ? new Response(bytes.slice(), { status: 200 })
            : new Response(null, { status: 404 }),
        )
      }),
    )
    recording = {
      ...withBlob(),
      statements: [...served.keys(), ...listed],
    }
    renderLibrary(webContext, [ENDPOINT])
  }

  const details = () => document.querySelector('details')

  it('says so when a recording was never signed', async () => {
    recording = withBlob()
    renderLibrary(webContext, [ENDPOINT])

    expect(
      await screen.findByText(
        'Not signed. There is no record of which device made it.',
      ),
    ).toBeInTheDocument()
  })

  it('names the device by fingerprint and the host by its receipt time', async () => {
    const claim = await claimFor(deviceKeys)
    const receipt = await createHostReceipt(
      claim,
      hostKeys,
      new Date(RECEIVED_AT),
    )
    const fingerprint = await keyFingerprint(claim.payload.deviceKey)

    await showRow([claim, receipt])

    expect(
      await screen.findByText(`Recorded on device ${fingerprint}`, {
        exact: false,
      }),
    ).toHaveTextContent(/received by the host/)
    expect(details()).toHaveTextContent(
      /Started .* and ended .*, by the recording device's clock\./,
    )
    expect(details()).toHaveTextContent(/Received .*, by the host's clock\./)
    expect(details()).toHaveTextContent(
      'Which host signed the receipt is not checked yet.',
    )
    const times = [...details()!.querySelectorAll('time')].map((time) =>
      time.getAttribute('dateTime'),
    )
    expect(times).toEqual(
      expect.arrayContaining([STARTED_AT, ENDED_AT, RECEIVED_AT]),
    )
  })

  it('says "this device" for a claim signed with the local key', async () => {
    const claim = await claimFor(deviceKeys)
    const receipt = await createHostReceipt(
      claim,
      hostKeys,
      new Date(RECEIVED_AT),
    )
    localDeviceKey = claim.payload.deviceKey

    await showRow([claim, receipt])

    expect(
      await screen.findByText('Recorded on this device', { exact: false }),
    ).toBeInTheDocument()
  })

  it('does not present a self-signed receipt as separate confirmation', async () => {
    const claim = await claimFor(hostKeys)
    const receipt = await createHostReceipt(
      claim,
      hostKeys,
      new Date(RECEIVED_AT),
    )
    localDeviceKey = claim.payload.deviceKey

    await showRow([claim, receipt])

    expect(
      await screen.findByText('Recorded by the host, on this device.'),
    ).toBeInTheDocument()
    expect(details()).toHaveTextContent(
      'The host recorded this itself and signed its own receipt, so the receipt is not separate confirmation.',
    )
    expect(details()).toHaveTextContent(/by the host's clock/)
  })

  it('marks a claim without a receipt as signed on the device only', async () => {
    const claim = await claimFor(deviceKeys)
    localDeviceKey = claim.payload.deviceKey

    await showRow([claim])

    expect(
      await screen.findByText(
        'Signed on this device. The host did not confirm when it arrived.',
      ),
    ).toBeInTheDocument()
    expect(details()).toHaveTextContent(/by the recording device's clock/)
    expect(details()).not.toHaveTextContent(/host's clock/)
  })

  it('shows the session from the claim', async () => {
    await showRow([await claimFor(deviceKeys, { sessionId: 'session-42' })])

    await screen.findByText(/^Signed on/)
    expect(details()).toHaveTextContent('Session session-42.')
  })

  it('shows the signed session record with its devices', async () => {
    const claim = await claimFor(deviceKeys, { sessionId: 'session-42' })
    const guestKey = await exportPublicKey(
      (await generateSigningKeyPair()).publicKey,
    )
    const record = await createSessionRecord(
      {
        sessionId: 'session-42',
        openedAt: new Date('2026-10-05T11:55:00.000Z'),
        closedAt: new Date('2026-10-05T12:10:00.000Z'),
        devices: [
          {
            deviceKey: claim.payload.deviceKey,
            spans: [
              {
                joinedAt: '2026-10-05T11:56:00.000Z',
                leftAt: '2026-10-05T12:10:00.000Z',
              },
            ],
          },
          {
            deviceKey: guestKey,
            label: 'Studio phone',
            spans: [
              {
                joinedAt: '2026-10-05T11:58:00.000Z',
                leftAt: '2026-10-05T12:01:00.000Z',
              },
            ],
          },
        ],
        claims: [await statementAddress(claim)],
      },
      hostKeys,
    )
    localDeviceKey = claim.payload.deviceKey

    await showRow([claim, record])

    await screen.findByText(/^Signed on/)
    expect(details()).toHaveTextContent(
      /Session session-42, open from .* to .*, by the host's clock\./,
    )
    const guestFingerprint = await keyFingerprint(guestKey)
    const devices = [...details()!.querySelectorAll('li')]
    await waitFor(() =>
      expect(devices.map((device) => device.textContent)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^Connected: this device, joined .* left .*\.$/,
          ),
          expect.stringMatching(
            new RegExp(`^Connected: device ${guestFingerprint},`),
          ),
        ]),
      ),
    )
    // The label is the device's own word for itself.
    expect(details()).not.toHaveTextContent(/Studio phone/)
    expect(details()).toHaveTextContent(
      'Which host signed the session record is not checked yet.',
    )
  })

  it('reports a session record for another session as a failed check', async () => {
    const claim = await claimFor(deviceKeys, { sessionId: 'session-42' })
    const record = await createSessionRecord(
      {
        sessionId: 'session-7',
        openedAt: new Date('2026-10-05T11:55:00.000Z'),
        closedAt: new Date('2026-10-05T12:10:00.000Z'),
        devices: [],
        claims: [await statementAddress(claim)],
      },
      hostKeys,
    )

    await showRow([claim, record])

    expect(
      await screen.findByText(
        "The signature check failed. This recording's record may have been changed.",
      ),
    ).toBeInTheDocument()
  })

  it('hides the session while the recording has none', async () => {
    await showRow([await claimFor(deviceKeys)])

    await screen.findByText(/^Signed on/)
    expect(details()).not.toHaveTextContent(/Session/)
  })

  it('reports a claim about other audio as a failed check', async () => {
    const otherAudio = { ...audio, hash: 'b'.repeat(64) }

    await showRow([await claimFor(deviceKeys, { blob: otherAudio })])

    expect(
      await screen.findByText(
        "The signature check failed. This recording's record may have been changed.",
      ),
    ).toBeInTheDocument()
    expect(details()).toHaveTextContent(
      '1 signed statement listed for this recording did not pass.',
    )
  })

  it('says it cannot check right now when no host has a statement', async () => {
    await showRow([await claimFor(deviceKeys)], ['c'.repeat(64)])

    expect(
      await screen.findByText("Can't check where this was recorded right now."),
    ).toBeInTheDocument()
    expect(details()).toHaveTextContent(
      'No host could send 1 statement for this recording.',
    )
  })
})
