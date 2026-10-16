import { afterEach, describe, expect, it } from 'vitest'
import { Repo, type AutomergeUrl } from '@automerge/automerge-repo'
import type { Recording, RootDocument } from '@tapes-monorepo/core'
import { listSessionRecord } from './sessionDelivery'

const CLAIM = 'aa'.repeat(32)
const RECEIPT = 'bb'.repeat(32)
const RECORD = 'ee'.repeat(32)

const openRepos: Repo[] = []

afterEach(async () => {
  await Promise.all(openRepos.splice(0).map((repo) => repo.shutdown()))
})

/** An in-memory repo holding a root document and its recordings. */
function seed(recordings: Partial<Recording>[]) {
  const repo = new Repo()
  openRepos.push(repo)
  const urls = recordings.map(
    (recording) => repo.create<Partial<Recording>>(recording).url,
  )
  const root = repo.create<RootDocument>({ recordings: urls })
  const statementsOf = async (url: AutomergeUrl) =>
    (await repo.find<Recording>(url)).doc().statements
  return { repo, docUrl: root.url, urls, statementsOf }
}

describe('listSessionRecord', () => {
  it('adds the record to a recording that lists one of its claims', async () => {
    const { repo, docUrl, urls, statementsOf } = seed([
      { statements: [CLAIM, RECEIPT] },
    ])

    expect(
      await listSessionRecord(repo, {
        docUrl,
        recordHash: RECORD,
        claims: [CLAIM],
      }),
    ).toEqual(urls)
    expect(await statementsOf(urls[0])).toEqual([CLAIM, RECEIPT, RECORD])
  })

  it('leaves recordings from other sessions alone', async () => {
    const { repo, docUrl, urls, statementsOf } = seed([
      { statements: ['cc'.repeat(32)] },
      {},
    ])

    expect(
      await listSessionRecord(repo, {
        docUrl,
        recordHash: RECORD,
        claims: [CLAIM],
      }),
    ).toEqual([])
    expect(await statementsOf(urls[0])).toEqual(['cc'.repeat(32)])
    expect(await statementsOf(urls[1])).toBeUndefined()
  })

  it('does not list the record twice', async () => {
    const { repo, docUrl, urls, statementsOf } = seed([
      { statements: [CLAIM, RECORD] },
    ])

    await listSessionRecord(repo, {
      docUrl,
      recordHash: RECORD,
      claims: [CLAIM],
    })

    expect(await statementsOf(urls[0])).toEqual([CLAIM, RECORD])
  })
})
