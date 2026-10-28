import path from 'path'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTrustedHosts, type TrustedHostEntry } from './trustedHosts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tapes-trusted-hosts-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const filePath = () => path.join(root, 'nested', 'trusted-hosts.json')

const entry = (
  overrides: Partial<TrustedHostEntry> = {},
): TrustedHostEntry => ({
  hostKey: 'host-key-one',
  hostLabel: 'Studio Mac',
  addedAt: '2026-10-28T10:00:00.000Z',
  ...overrides,
})

const readFileJson = async () =>
  JSON.parse(await readFile(filePath(), 'utf8')) as {
    hosts: TrustedHostEntry[]
  }

describe('createTrustedHosts', () => {
  it('starts empty when the file does not exist', async () => {
    expect(await createTrustedHosts(filePath()).list()).toEqual([])
  })

  it('keeps an added key across a restart', async () => {
    await createTrustedHosts(filePath()).add(entry())

    expect(await createTrustedHosts(filePath()).list()).toEqual([entry()])
  })

  it('replaces the entry with the same host key instead of adding a second', async () => {
    const hosts = createTrustedHosts(filePath())
    await hosts.add(entry())
    await hosts.add(entry({ hostLabel: 'Studio Mac 2', addedAt: 'later' }))

    expect(await hosts.list()).toEqual([
      entry({ hostLabel: 'Studio Mac 2', addedAt: 'later' }),
    ])
  })

  it('keeps other keys when one is removed', async () => {
    const hosts = createTrustedHosts(filePath())
    await hosts.add(entry())
    await hosts.add(entry({ hostKey: 'host-key-two' }))

    expect(await hosts.remove('host-key-one')).toBe(true)
    expect(await hosts.list()).toEqual([entry({ hostKey: 'host-key-two' })])
  })

  it('reports a removal of a key it does not hold', async () => {
    const hosts = createTrustedHosts(filePath())
    await hosts.add(entry())

    expect(await hosts.remove('host-key-two')).toBe(false)
    expect(await hosts.list()).toEqual([entry()])
  })

  // Two operator actions in the same tick must not each write over the other.
  it('keeps both keys when two adds overlap', async () => {
    const hosts = createTrustedHosts(filePath())
    await Promise.all([
      hosts.add(entry()),
      hosts.add(entry({ hostKey: 'host-key-two' })),
    ])

    expect(await hosts.list()).toHaveLength(2)
    expect((await readFileJson()).hosts).toHaveLength(2)
  })

  it('accepts a key with no host label', async () => {
    const hosts = createTrustedHosts(filePath())
    const typedIn = { hostKey: 'host-key-one', addedAt: 'now' }
    await hosts.add(typedIn)

    expect(await createTrustedHosts(filePath()).list()).toEqual([typedIn])
  })

  it('skips entries that are not host keys', async () => {
    await writeFile(
      path.join(root, 'hosts.json'),
      JSON.stringify({ hosts: [entry(), { hostKey: 7 }, null] }),
    )

    expect(
      await createTrustedHosts(path.join(root, 'hosts.json')).list(),
    ).toEqual([entry()])
  })

  // Reading an empty list out of a damaged file would quietly withdraw trust.
  it('refuses a file with no list of hosts', async () => {
    await writeFile(path.join(root, 'hosts.json'), JSON.stringify({}))

    await expect(
      createTrustedHosts(path.join(root, 'hosts.json')).list(),
    ).rejects.toThrow('no list of hosts')
  })
})
