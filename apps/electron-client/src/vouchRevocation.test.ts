import crypto from 'crypto'
import path from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Repo, type AutomergeUrl } from '@automerge/automerge-repo'
import { STATEMENT_MIME_TYPE } from '@tapes-monorepo/provenance'
import type { Recording, RootDocument } from '@tapes-monorepo/core'
import { createBlobStore, type BlobStore } from './blobStore'
import { listDeviceRevocation } from './vouchRevocation'

const VOUCH = 'aa'.repeat(32)
const CLAIM = 'bb'.repeat(32)

const bytes = new TextEncoder().encode('{"payload":{},"signature":"x"}')
const address = crypto.createHash('sha256').update(bytes).digest('hex')

let root: string
let store: BlobStore
const openRepos: Repo[] = []

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tapes-blobs-'))
  store = createBlobStore(root)
})

afterEach(async () => {
  await Promise.all(openRepos.splice(0).map((repo) => repo.shutdown()))
  await rm(root, { recursive: true, force: true })
})

/** An in-memory repo holding a root document and its recordings. */
function seed(recordings: Partial<Recording>[]) {
  const repo = new Repo()
  openRepos.push(repo)
  const urls = recordings.map(
    (recording) => repo.create<Partial<Recording>>(recording).url,
  )
  const doc = repo.create<RootDocument>({ recordings: urls })
  const statementsOf = async (url: AutomergeUrl) =>
    (await repo.find<Recording>(url)).doc().statements
  return { repo, docUrl: doc.url, urls, statementsOf }
}

const revoke = (repo: Repo, docUrl: string) =>
  listDeviceRevocation(repo, store, {
    docUrl,
    bytes,
    address,
    deviceLink: VOUCH,
  })

describe('listDeviceRevocation', () => {
  it('stores the revocation and lists it on a recording naming the vouch', async () => {
    const { repo, docUrl, urls, statementsOf } = seed([
      { statements: [CLAIM, VOUCH] },
    ])

    expect(await revoke(repo, docUrl)).toEqual(urls)
    expect(await statementsOf(urls[0])).toEqual([CLAIM, VOUCH, address])
    expect(await store.stat(address)).toMatchObject({
      mimeType: STATEMENT_MIME_TYPE,
      size: bytes.length,
    })
  })

  it('leaves recordings that name no such vouch alone', async () => {
    const { repo, docUrl, urls, statementsOf } = seed([
      { statements: [CLAIM] },
      {},
    ])

    expect(await revoke(repo, docUrl)).toEqual([])
    expect(await statementsOf(urls[0])).toEqual([CLAIM])
    expect(await statementsOf(urls[1])).toBeUndefined()
    expect(await store.has(address)).toBe(false)
  })

  it('does not list the revocation twice', async () => {
    const { repo, docUrl, urls, statementsOf } = seed([
      { statements: [VOUCH, address] },
    ])

    expect(await revoke(repo, docUrl)).toEqual(urls)
    expect(await statementsOf(urls[0])).toEqual([VOUCH, address])
  })

  it('keeps the revocation under every recording it covers', async () => {
    const { repo, docUrl, urls } = seed([
      { statements: [VOUCH] },
      { statements: [VOUCH] },
    ])

    expect(await revoke(repo, docUrl)).toEqual(urls)
    // One object, referenced by both recordings, so it survives until the
    // last of them is deleted.
    expect(await store.refs(address)).toEqual(urls)
  })
})
