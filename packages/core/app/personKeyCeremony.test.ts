import { afterEach, describe, expect, it, vi } from 'vitest'
import { toBase64Url } from '@tapes-monorepo/provenance'
import {
  CEREMONY_PROTOCOL,
  CEREMONY_PROTOCOL_VERSION,
  runPasskeyCeremony,
  type CeremonyOutcome,
} from './personKeyCeremony'

const ORIGIN = 'https://identity.example'

type FakeTab = {
  closed: boolean
  close: () => void
  postMessage: ReturnType<typeof vi.fn>
}

function fakeTab(): FakeTab {
  const tab: FakeTab = {
    closed: false,
    close: () => {
      tab.closed = true
    },
    postMessage: vi.fn(),
  }
  return tab
}

/**
 * Delivers a message as the ceremony page would. jsdom refuses a plain object
 * as `source`, so it is attached after the event is built.
 */
function deliver(data: unknown, source: unknown, origin = ORIGIN) {
  const event = new MessageEvent('message', { data, origin })
  Object.defineProperty(event, 'source', { value: source })
  window.dispatchEvent(event)
}

function message(fields: Record<string, unknown>) {
  return {
    tapes: CEREMONY_PROTOCOL,
    version: CEREMONY_PROTOCOL_VERSION,
    ...fields,
  }
}

/** The shape the page sends back on success. */
function resultFor(nonce: unknown, prf = new Uint8Array(32).fill(7)) {
  return message({
    type: 'result',
    nonce,
    rpId: 'tapes.network',
    credentialId: 'Y3JlZA',
    prf: toBase64Url(prf),
  })
}

function start(options: { tab: FakeTab | null; timeoutMs?: number }) {
  const opened: string[] = []
  const outcome = runPasskeyCeremony(
    { action: 'create', hostName: 'Studio', personName: 'Chris' },
    {
      origin: ORIGIN,
      timeoutMs: options.timeoutMs,
      open: (url) => {
        opened.push(url)
        return options.tab as unknown as Window | null
      },
    },
  )
  return { outcome, opened }
}

/** The nonce the ceremony generated, read off the request it sent. */
function nonceOf(tab: FakeTab): string {
  const [payload] = tab.postMessage.mock.calls.at(-1) ?? []
  return (payload as { nonce: string }).nonce
}

afterEach(() => {
  vi.useRealTimers()
})

describe('runPasskeyCeremony', () => {
  it('answers a ready message with the request, then returns the PRF output', async () => {
    const tab = fakeTab()
    const { outcome, opened } = start({ tab })

    expect(opened).toEqual([
      `${ORIGIN}/#o=${encodeURIComponent(window.location.origin)}`,
    ])

    deliver(message({ type: 'ready' }), tab)
    const [payload, target] = tab.postMessage.mock.calls[0]
    expect(target).toBe(ORIGIN)
    expect(payload).toMatchObject({
      type: 'request',
      action: 'create',
      hostName: 'Studio',
      personName: 'Chris',
    })

    deliver(resultFor(nonceOf(tab)), tab)
    await expect(outcome).resolves.toEqual({
      ok: true,
      credentialId: 'Y3JlZA',
      rpId: 'tapes.network',
      prf: new Uint8Array(32).fill(7),
    })
  })

  it('reports a blocked tab without waiting for anything', async () => {
    const { outcome } = start({ tab: null })
    await expect(outcome).resolves.toEqual({ ok: false, problem: 'blocked' })
  })

  it('ignores a message from another origin', async () => {
    vi.useFakeTimers()
    const tab = fakeTab()
    const { outcome } = start({ tab, timeoutMs: 1000 })

    deliver(message({ type: 'ready' }), tab, 'https://evil.example')
    expect(tab.postMessage).not.toHaveBeenCalled()

    deliver(message({ type: 'ready' }), tab)
    deliver(resultFor(nonceOf(tab)), tab, 'https://evil.example')

    await vi.advanceTimersByTimeAsync(1000)
    await expect(outcome).resolves.toEqual({ ok: false, problem: 'timeout' })
  })

  it('ignores a message from a window other than the tab it opened', async () => {
    vi.useFakeTimers()
    const tab = fakeTab()
    const { outcome } = start({ tab, timeoutMs: 1000 })

    deliver(message({ type: 'ready' }), fakeTab())
    expect(tab.postMessage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    await expect(outcome).resolves.toEqual({ ok: false, problem: 'timeout' })
  })

  it('ignores a result carrying another ceremony’s nonce', async () => {
    vi.useFakeTimers()
    const tab = fakeTab()
    const { outcome } = start({ tab, timeoutMs: 1000 })

    deliver(message({ type: 'ready' }), tab)
    deliver(resultFor('some-other-nonce'), tab)

    await vi.advanceTimersByTimeAsync(1000)
    await expect(outcome).resolves.toEqual({ ok: false, problem: 'timeout' })
  })

  it('passes each problem the page reports back to the caller', async () => {
    for (const reason of ['declined', 'no-prf', 'unsupported', 'failed']) {
      const tab = fakeTab()
      const { outcome } = start({ tab })
      deliver(message({ type: 'ready' }), tab)
      deliver(message({ type: 'error', nonce: nonceOf(tab), reason }), tab)
      await expect(outcome).resolves.toEqual({ ok: false, problem: reason })
    }
  })

  it('treats an unknown reason, and a damaged result, as a failure', async () => {
    const tab = fakeTab()
    const { outcome } = start({ tab })
    deliver(message({ type: 'ready' }), tab)
    deliver(message({ type: 'error', nonce: nonceOf(tab), reason: 'who' }), tab)
    await expect(outcome).resolves.toEqual({ ok: false, problem: 'failed' })

    const second = fakeTab()
    const run = start({ tab: second })
    deliver(message({ type: 'ready' }), second)
    deliver(
      { ...resultFor(nonceOf(second)), prf: toBase64Url(new Uint8Array(16)) },
      second,
    )
    await expect(run.outcome).resolves.toEqual({
      ok: false,
      problem: 'failed',
    })
  })

  it('gives up when the person closes the tab', async () => {
    vi.useFakeTimers()
    const tab = fakeTab()
    const { outcome } = start({ tab })

    tab.closed = true
    await vi.advanceTimersByTimeAsync(500)
    await expect(outcome).resolves.toEqual({ ok: false, problem: 'closed' })
  })

  it('stops listening once it has an answer', async () => {
    const tab = fakeTab()
    const { outcome } = start({ tab })
    deliver(message({ type: 'ready' }), tab)
    deliver(resultFor(nonceOf(tab)), tab)
    const first = (await outcome) as CeremonyOutcome

    // A second result, from a page that posted twice, changes nothing.
    deliver(resultFor(nonceOf(tab), new Uint8Array(32).fill(9)), tab)
    expect(first).toMatchObject({ ok: true })
    await expect(outcome).resolves.toBe(first)
  })
})
