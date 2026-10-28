import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  exportPublicKey,
  generateSigningKeyPair,
} from '@tapes-monorepo/provenance'
import type { TrustedHostEntry, TrustedHosts } from '@/trustedHosts'
import {
  AddTrustedHostChannel,
  GetTrustedHostsChannel,
  RemoveTrustedHostChannel,
  setTrustedHostsForTesting,
} from './TrustedHostChannels'

// The channels read the store's path from Electron's userData directory.
vi.mock('@/syncServerConfig', () => ({ trustedHostsPath: () => '/unused' }))

let entries: TrustedHostEntry[]
let store: TrustedHosts

beforeEach(() => {
  entries = []
  store = {
    list: () => Promise.resolve(entries),
    add: (entry) => {
      entries = [
        ...entries.filter((each) => each.hostKey !== entry.hostKey),
        entry,
      ]
      return Promise.resolve()
    },
    remove: (hostKey) => {
      const next = entries.filter((each) => each.hostKey !== hostKey)
      const removed = next.length !== entries.length
      entries = next
      return Promise.resolve(removed)
    },
  }
  setTrustedHostsForTesting(store)
})

afterEach(() => {
  setTrustedHostsForTesting(undefined)
  vi.restoreAllMocks()
})

const hostKey = async () =>
  exportPublicKey((await generateSigningKeyPair()).publicKey)

describe('the trusted host channels', () => {
  it('answers with the keys the operator trusts', async () => {
    const key = await hostKey()
    await store.add({ hostKey: key, hostLabel: 'Studio Mac', addedAt: 'now' })

    expect(await new GetTrustedHostsChannel().handle()).toEqual({
      success: true,
      data: {
        hosts: [{ hostKey: key, hostLabel: 'Studio Mac', addedAt: 'now' }],
      },
    })
  })

  it('trusts a key with the name from the vouch it came from', async () => {
    const key = await hostKey()

    const response = await new AddTrustedHostChannel().handle({
      data: { hostKey: key, hostLabel: 'Studio Mac' },
    })

    expect(response).toEqual({ success: true })
    expect(entries).toEqual([
      { hostKey: key, hostLabel: 'Studio Mac', addedAt: expect.any(String) },
    ])
  })

  it('trusts a key that comes without a name', async () => {
    const key = await hostKey()

    await new AddTrustedHostChannel().handle({ data: { hostKey: key } })

    expect(entries).toEqual([{ hostKey: key, addedAt: expect.any(String) }])
  })

  // The label is another host's unverified text, like a device label.
  it('strips control characters from the name', async () => {
    const key = await hostKey()

    await new AddTrustedHostChannel().handle({
      data: { hostKey: key, hostLabel: 'Studio Mac  ' },
    })

    expect(entries[0]?.hostLabel).toBe('Studio Mac')
  })

  // The Settings form leans on this to reject a mistyped key.
  it.each([
    ['text that is not a key', 'not-a-key'],
    ['a key of the wrong length', 'AAAA'],
    ['nothing at all', undefined],
  ])('refuses %s', async (_case, value) => {
    const response = await new AddTrustedHostChannel().handle({
      data: { hostKey: value },
    })

    expect(response).toEqual({ success: false, error: expect.any(Error) })
    expect(entries).toEqual([])
  })

  it('removes a key the operator no longer trusts', async () => {
    const key = await hostKey()
    await store.add({ hostKey: key, addedAt: 'now' })

    const response = await new RemoveTrustedHostChannel().handle({
      data: { hostKey: key },
    })

    expect(response).toEqual({ success: true })
    expect(entries).toEqual([])
  })

  it('reports a key it does not hold', async () => {
    const response = await new RemoveTrustedHostChannel().handle({
      data: { hostKey: await hostKey() },
    })

    expect(response).toEqual({ success: false, error: expect.any(Error) })
  })

  it('answers with a failure when the list cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setTrustedHostsForTesting({
      ...store,
      list: () => Promise.reject(new Error('unreadable')),
    })

    expect(await new GetTrustedHostsChannel().handle()).toEqual({
      success: false,
      error: expect.any(Error),
    })
  })
})
