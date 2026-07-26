import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import type { AppContextValue } from '@/context/AppContext'
import { App } from './App'

const STORED_URL = 'automerge:stored-doc'
const CREATED_URL = 'automerge:created-doc' as AutomergeUrl

// Every Repo construction, so tests can assert on the network array App built.
const { repoConfigs, findCalls, createCalls, control } = vi.hoisted(() => ({
  repoConfigs: [] as { network: unknown[]; storage: unknown }[],
  findCalls: [] as string[],
  createCalls: [] as unknown[],
  // Lets one test hold find() open so App is observed mid-initialization.
  control: { blockFind: false },
}))

// Hoisted: vi.mock factories run before the module body, so the stand-in
// adapters have to exist by then.
const { FakeBroadcastAdapter, FakeWebSocketAdapter, FakeStorageAdapter } =
  vi.hoisted(() => ({
    FakeBroadcastAdapter: class {
      readonly kind = 'broadcast'
    },
    FakeWebSocketAdapter: class {
      readonly kind = 'websocket'
      constructor(public url: string) {}
    },
    FakeStorageAdapter: class {
      readonly kind = 'indexeddb'
    },
  }))

vi.mock('@automerge/automerge-repo-network-broadcastchannel', () => ({
  BroadcastChannelNetworkAdapter: FakeBroadcastAdapter,
}))

vi.mock('@automerge/automerge-repo-network-websocket', () => ({
  BrowserWebSocketClientAdapter: FakeWebSocketAdapter,
}))

vi.mock('@automerge/automerge-repo-storage-indexeddb', () => ({
  IndexedDBStorageAdapter: FakeStorageAdapter,
}))

vi.mock('@automerge/automerge-repo', () => ({
  isValidAutomergeUrl: (url: string) => url.startsWith('automerge:'),
  Repo: class {
    constructor(config: { network: unknown[]; storage: unknown }) {
      repoConfigs.push(config)
    }
    async find(url: string) {
      findCalls.push(url)
      if (control.blockFind) {
        await new Promise(() => {})
      }
      return { url }
    }
    create(initialValue: unknown) {
      createCalls.push(initialValue)
      return { url: CREATED_URL }
    }
  },
}))

// The view tree below App is irrelevant here — these tests are about how App
// wires up the Repo — so collapse the providers and children to a marker that
// tells us the async initialize() finished and `repo` state landed.
vi.mock('./context/Providers', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="providers">{children}</div>
  ),
}))

vi.mock('@/context/ViewContext', () => ({
  useView: () => ({ currentView: 'recorder', setCurrentView: vi.fn() }),
  navigationConfig: [],
  viewComponentMap: { recorder: null },
}))

vi.mock('./context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({ currentUrl: undefined }),
}))

vi.mock('./components/AudioPlayer', () => ({
  AudioPlayer: () => null,
}))

const appContextValue: AppContextValue = {
  type: 'web-client',
  worker: {} as unknown as Worker,
}

const renderApp = async (
  syncServerUrl?: string | null,
  { strict = false }: { strict?: boolean } = {},
) => {
  const tree = (
    <App appContextValue={appContextValue} syncServerUrl={syncServerUrl} />
  )
  render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  await screen.findByTestId('providers')
}

const networkOf = (index = 0) => repoConfigs[index].network
const adaptersOfKind = (kind: string, index = 0) =>
  networkOf(index).filter(
    (adapter) => (adapter as { kind: string }).kind === kind,
  )

beforeEach(() => {
  repoConfigs.length = 0
  findCalls.length = 0
  createCalls.length = 0
  control.blockFind = false
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('App network adapters', () => {
  it('builds a repo with only the broadcast adapter when no sync url is given', async () => {
    await renderApp(undefined)

    expect(repoConfigs).toHaveLength(1)
    expect(networkOf()).toHaveLength(1)
    expect(adaptersOfKind('broadcast')).toHaveLength(1)
    expect(adaptersOfKind('websocket')).toHaveLength(0)
  })

  // The point of making the prop optional: these are the values the call sites
  // can hand over when there is no sync server, and none may produce a socket
  // that then loops on failing reconnects.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
  ])(
    'adds no websocket adapter when the sync url is %s',
    async (_label, url) => {
      await renderApp(url)

      expect(adaptersOfKind('websocket')).toHaveLength(0)
    },
  )

  it('adds a websocket adapter pointed at the sync url when one is given', async () => {
    await renderApp('ws://192.168.1.2:9001')

    expect(networkOf()).toHaveLength(2)
    const [websocket] = adaptersOfKind('websocket') as InstanceType<
      typeof FakeWebSocketAdapter
    >[]
    expect(websocket.url).toBe('ws://192.168.1.2:9001')
  })

  // Cross-tab sync must not depend on remote sync being configured.
  it.each([
    ['without a sync url', undefined],
    ['with a sync url', 'ws://192.168.1.2:9001'],
  ])('always includes the broadcast adapter %s', async (_label, url) => {
    await renderApp(url)

    expect(adaptersOfKind('broadcast')).toHaveLength(1)
  })

  it('uses IndexedDB for storage', async () => {
    await renderApp(undefined)

    expect(repoConfigs[0].storage).toBeInstanceOf(FakeStorageAdapter)
  })
})

describe('App initialization guard', () => {
  // didInitRef exists because initialize() is async and StrictMode double-invokes
  // effects: without it each run builds its own Repo and its own websocket.
  it('builds exactly one repo under StrictMode double-invocation', async () => {
    await renderApp('ws://192.168.1.2:9001', { strict: true })

    expect(repoConfigs).toHaveLength(1)
    expect(adaptersOfKind('websocket')).toHaveLength(1)
    expect(adaptersOfKind('broadcast')).toHaveLength(1)
  })

  it('creates the recordings doc only once under StrictMode', async () => {
    await renderApp(undefined, { strict: true })

    expect(createCalls).toEqual([{ recordings: [] }])
  })
})

describe('App document bootstrap', () => {
  it('creates a doc and persists its url when none is stored', async () => {
    await renderApp(undefined)

    expect(createCalls).toEqual([{ recordings: [] }])
    expect(findCalls).toEqual([])
    expect(localStorage.getItem('automergeUrl')).toBe(CREATED_URL)
  })

  it('finds the stored doc instead of creating a new one', async () => {
    localStorage.setItem('automergeUrl', STORED_URL)

    await renderApp(undefined)

    expect(findCalls).toEqual([STORED_URL])
    expect(createCalls).toEqual([])
    expect(localStorage.getItem('automergeUrl')).toBe(STORED_URL)
  })

  it('creates a fresh doc when the stored url is not a valid automerge url', async () => {
    localStorage.setItem('automergeUrl', 'not-an-automerge-url')

    await renderApp(undefined)

    expect(findCalls).toEqual([])
    expect(createCalls).toEqual([{ recordings: [] }])
    expect(localStorage.getItem('automergeUrl')).toBe(CREATED_URL)
  })

  it('renders a loading state until the repo is ready', () => {
    localStorage.setItem('automergeUrl', STORED_URL)
    control.blockFind = true

    render(<App appContextValue={appContextValue} syncServerUrl={undefined} />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByTestId('providers')).toBeNull()
  })
})
