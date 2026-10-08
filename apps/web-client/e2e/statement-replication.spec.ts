import type { Page } from '@playwright/test'
import { test, expect, cachedBlobHashes } from './fixtures'
import {
  HOST_ORIGIN,
  Host,
  PAIRING_TOKEN,
  disposeHost,
  hostObjects,
  startHost,
  type SeededRecording,
} from './host'
import { SECOND_HOST_PORT } from './ports'

/**
 * Keep offline copies a recording to a host that lacked it, along with its
 * signed claim and receipt.
 *
 * Two hosts run here. The source host holds the recording and signs receipts.
 * The guest syncs with it as a remote server. The empty host sits behind the
 * dev server's `/blobs` proxy. The guest tries the page origin first, so the
 * empty host answers 404 before the source host answers with the audio. Only
 * a host that answered 404 gets a copy.
 *
 * The recording is seeded on the source host rather than recorded in the
 * browser. Recording needs a working mic, and the copy is what is under test.
 */

const sourceHost = new Host(SECOND_HOST_PORT)

let rootDocumentUrl: string
let tape: SeededRecording

test.beforeAll(async () => {
  // The empty host. It needs no signing key: it stores the receipt the source
  // host signed, it does not make one.
  await startHost()
  ;({ rootDocumentUrl } = await sourceHost.start({ signs: true }))
  tape = await sourceHost.seed({
    name: 'Signed tape',
    seconds: 2,
    withClaim: true,
  })
})

test.afterAll(async () => {
  await sourceHost.dispose()
  await disposeHost()
})

/**
 * Pairs with the source host for sync. The remote URL carries the token in
 * its query, because the app adds the token only to a same-origin socket.
 */
const pair = async (page: Page) => {
  const remote = `ws://127.0.0.1:${SECOND_HOST_PORT}/sync?t=${PAIRING_TOKEN}`
  // Merged, not replaced: the app stores the pairing token in the same blob.
  await page.addInitScript((url) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}')
    localStorage.setItem(
      'settings',
      JSON.stringify({ ...settings, remoteSyncServerUrl: url }),
    )
  }, remote)
  await page.goto(
    `/?am=${encodeURIComponent(rootDocumentUrl)}&pt=${PAIRING_TOKEN}`,
  )
  await page.getByRole('button', { name: 'Library' }).click()
}

/** One recording's row. See two-device.spec.ts for why it is a `div.group`. */
const row = (page: Page, name: string) =>
  page.locator('div.group').filter({ hasText: name }).first()

/** One object as a guest would fetch it, or null when the host lacks it. */
const fetchObject = async (origin: string, hash: string) => {
  const response = await fetch(`${origin}/blobs/${hash}`, {
    headers: { Authorization: `Bearer ${PAIRING_TOKEN}` },
  })
  return response.ok ? Buffer.from(await response.arrayBuffer()) : null
}

test('pinning copies the audio, claim and receipt to a host that lacked them', async ({
  page,
}) => {
  // The source host stored a claim and a receipt, and the doc lists both.
  expect(tape.statements).toHaveLength(2)
  const hashes = [tape.descriptor.hash, ...tape.statements]
  expect(await hostObjects()).toEqual([])

  await pair(page)
  const recording = row(page, 'Signed tape')
  await recording.getByTitle('Options').click()
  await recording.getByTitle(/Keep this recording playable/).click()
  await expect
    .poll(() => cachedBlobHashes(page))
    .toContain(tape.descriptor.hash)

  // The copy runs after the pin, in the background, so wait for all three.
  await expect
    .poll(
      async () => (await hostObjects()).map((object) => object.hash).sort(),
      { timeout: 30_000 },
    )
    .toEqual([...hashes].sort())

  const copied = new Map(
    (await hostObjects()).map((object) => [object.hash, object]),
  )
  expect(copied.get(tape.descriptor.hash)?.mimeType).toBe('audio/wav')
  for (const hash of tape.statements) {
    expect(copied.get(hash)?.mimeType).toBe('application/json')
  }

  // Each object holds the same bytes on both hosts. Read now, while the
  // source host is still up.
  const originals = new Map<string, Buffer | null>()
  for (const hash of hashes) {
    originals.set(hash, await fetchObject(sourceHost.origin, hash))
  }

  // With the source host gone, the copy is all there is.
  await sourceHost.stop()
  for (const hash of hashes) {
    const served = await fetchObject(HOST_ORIGIN, hash)
    expect(served, `the copy of ${hash}`).not.toBeNull()
    expect(served!.equals(originals.get(hash)!)).toBe(true)
  }
})
