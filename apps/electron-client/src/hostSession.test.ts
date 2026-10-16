import { afterEach, describe, expect, it, vi } from 'vitest'
import { Repo, type AutomergeUrl } from '@automerge/automerge-repo'
import type { RootDocument } from '@tapes-monorepo/core'
import { createHostSession } from './hostSession'
import { createSessionRecorder } from './sessionRecorder'

const T0 = Date.parse('2026-10-16T10:00:00.000Z')

const openRepos: Repo[] = []

afterEach(async () => {
  await Promise.all(openRepos.splice(0).map((repo) => repo.shutdown()))
})

/**
 * A host session over an in-memory repo and a real recorder. Grace periods
 * never end, so no record is signed.
 */
function setup(root: RootDocument = { recordings: [] }) {
  const repo = new Repo()
  openRepos.push(repo)
  const docUrl = repo.create<RootDocument>(root).url
  const recorder = createSessionRecorder({
    loadSigningKey: () => Promise.reject(new Error('not signing in tests')),
    getStore: () => undefined,
    getConnections: () => [],
    now: () => T0,
    wait: () => new Promise(() => {}),
  })
  let next = 0
  const host = createHostSession({
    sessions: recorder,
    getRepo: () => repo,
    newSessionId: () => `session-${++next}`,
  })
  const published = async (url: AutomergeUrl = docUrl) =>
    (await repo.find<RootDocument>(url)).doc().session
  return { repo, docUrl, recorder, host, published }
}

describe('the host session', () => {
  it('opens a session and publishes it in the doc', async () => {
    const { docUrl, recorder, host, published } = setup()

    const session = await host.start(docUrl)

    const expected = {
      sessionId: 'session-1',
      startedAt: new Date(T0).toISOString(),
    }
    expect(session).toEqual(expected)
    expect(host.current()).toEqual(expected)
    expect(recorder.current()).toEqual({ sessionId: 'session-1', openedAt: T0 })
    expect(await published()).toEqual(expected)
  })

  it('closes the session and clears the doc on stop', async () => {
    const { docUrl, recorder, host, published } = setup()
    await host.start(docUrl)

    await host.stop()

    expect(host.current()).toBeUndefined()
    expect(recorder.current()).toBeUndefined()
    expect(await published()).toBeUndefined()
  })

  it('can start again while the last session is in its grace period', async () => {
    const { docUrl, host, published } = setup()
    await host.start(docUrl)
    await host.stop()

    await host.start(docUrl)

    expect(await published()).toMatchObject({ sessionId: 'session-2' })
  })

  it('refuses a second start while a session is open', async () => {
    const { repo, docUrl, host, published } = setup()
    const otherUrl = repo.create<RootDocument>({ recordings: [] }).url
    await host.start(docUrl)

    await expect(host.start(otherUrl)).rejects.toThrow(
      'Session session-1 is already open',
    )
    expect(host.current()).toMatchObject({ sessionId: 'session-1' })
    expect(await published()).toMatchObject({ sessionId: 'session-1' })
    expect(await published(otherUrl)).toBeUndefined()
  })

  it('does nothing on stop when no session is open', async () => {
    const { host } = setup()

    await expect(host.stop()).resolves.toBeUndefined()
  })

  it('opens nothing when the doc cannot be found', async () => {
    const { repo, recorder } = setup()
    const host = createHostSession({
      sessions: recorder,
      getRepo: () => repo,
      findTimeoutMs: 10,
    })
    // Made in a repo the host is not connected to.
    const elsewhere = new Repo()
    openRepos.push(elsewhere)
    const missing = elsewhere.create<RootDocument>({ recordings: [] }).url

    await expect(host.start(missing)).rejects.toThrow()
    expect(recorder.current()).toBeUndefined()
  })

  it('clears a field left by a crash on startup', async () => {
    const { docUrl, host, published } = setup({
      recordings: [],
      session: { sessionId: 'crashed', startedAt: '2026-10-15T09:00:00.000Z' },
    })

    await host.clearStale(docUrl)

    expect(await published()).toBeUndefined()
  })

  it('keeps the field of the session that is open', async () => {
    const { docUrl, host, published } = setup()
    await host.start(docUrl)

    await host.clearStale(docUrl)

    expect(await published()).toMatchObject({ sessionId: 'session-1' })
  })

  it('does not change a doc without a session', async () => {
    const { repo, docUrl, host } = setup()
    const handle = await repo.find<RootDocument>(docUrl)
    const onChange = vi.fn()
    handle.on('change', onChange)

    await host.clearStale(docUrl)

    expect(onChange).not.toHaveBeenCalled()
  })
})
