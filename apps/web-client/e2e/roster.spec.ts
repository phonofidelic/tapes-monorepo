import { test, expect, type Page } from '@playwright/test'
import {
  confirmHostVouch,
  disposeHost,
  hostObjects,
  hostPendingVouches,
  hostRoster,
  hostSignedVouches,
  hostStatements,
  listHostStatement,
  peerStatements,
  revokeHostVouch,
  seedRecording,
  startHost,
  PAIRING_TOKEN,
} from './host'
import { STATEMENT_MIME_TYPE } from '@tapes-monorepo/provenance'

/**
 * A guest's first join puts the person on the host's roster and backs up
 * their person key. A later guest with no keys, as after the host's IP
 * changed, picks that person and the host vouches for it. The person can then
 * restore their person key from the backup, which replaces the vouch. The
 * host signs, because vouching needs its key.
 *
 * The last test is the operator's side: withdrawing a vouch the host gave the
 * wrong person. It runs after the others so it has a signed vouch to withdraw.
 *
 * Each test gets a fresh browser context, which is a device with no keys.
 * Later tests need the person and the backup the first one made, so they run
 * in order.
 *
 * Plain Playwright `test`, not the fixture: the fixture presses "Not now" on
 * the very prompt this spec fills in.
 */

test.describe.configure({ mode: 'serial' })

let rootDocumentUrl: string
let hostKey: string | undefined
/** Sam's backup, as the first test saved it. */
let backup: { passphrase: string; qrCode: Buffer } | undefined

/** One record from the guest's key store, read as the worker stored it. */
const readKeyRecord = (page: Page, id: string) =>
  page.evaluate(
    (key) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('tapes-provenance')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const get = open.result
            .transaction('keys')
            .objectStore('keys')
            .get(key)
          get.onsuccess = () => resolve(get.result)
          get.onerror = () => reject(get.error)
        }
      }),
    id,
  )

test.beforeAll(async () => {
  ;({ rootDocumentUrl, hostKey } = await startHost({ signs: true }))
})

/** The pairing link, with the host key a guest pins as `hk`. */
const pairingUrl = () =>
  `/?am=${encodeURIComponent(rootDocumentUrl)}&pt=${PAIRING_TOKEN}&hk=${hostKey}`

test.afterAll(async () => {
  await disposeHost()
})

test('a guest joins the host roster with a name and a PIN', async ({
  page,
}) => {
  await page.goto(pairingUrl())

  const join = page.getByRole('dialog', { name: 'Tell the host who you are' })
  await join.getByLabel('Your name').fill('Sam')
  await join.getByLabel('PIN (optional)').fill('4821')
  await join.getByRole('button', { name: 'Join' }).click()

  await expect(
    page.getByRole('dialog', { name: 'Back up your person key' }),
  ).toBeVisible()
  expect(await hostRoster()).toEqual([
    expect.objectContaining({ name: 'Sam', hasPin: true, pinLocked: false }),
  ])

  // Joined once is joined. A reload goes straight to the backup.
  await page.reload()
  const backUp = page.getByRole('dialog', { name: 'Back up your person key' })
  await expect(backUp).toBeVisible()
  await expect(join).toHaveCount(0)

  // Kept for the restore test: the passphrase and a picture of the QR code,
  // as a person would photograph it.
  const passphrase = await backUp
    .getByTestId('generated-passphrase')
    .textContent()
  await backUp.getByRole('button', { name: 'Lock backup' }).click()
  await backUp.getByRole('button', { name: 'Show QR code' }).click()
  const qrCode = await backUp
    .locator('svg', {
      has: page.locator('title', { hasText: 'Person key backup' }),
    })
    .screenshot()
  await backUp.getByRole('button', { name: 'I saved it' }).click()
  await backUp
    .getByLabel('Type the passphrase again to check the backup opens')
    .fill(passphrase!)
  await backUp.getByRole('button', { name: 'Check' }).click()
  await expect(backUp).toHaveCount(0)
  backup = { passphrase: passphrase!, qrCode }
})

test('a guest that lost its keys is vouched for with its PIN', async ({
  page,
}) => {
  await page.goto(pairingUrl())

  const welcome = page.getByRole('dialog', {
    name: 'Have you been here before?',
  })
  await welcome.getByRole('button', { name: 'Sam' }).click()
  const rejoin = page.getByRole('dialog', { name: 'Welcome back, Sam' })
  await rejoin.getByLabel('Your PIN').fill('4821')
  await rejoin.getByRole('button', { name: 'Use PIN' }).click()

  await expect(rejoin).toHaveCount(0)
  // Nothing to back up: the device holds the host's vouch, not a person key.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await readKeyRecord(page, 'vouch')).toMatchObject({
    payload: { personName: 'Sam', method: 'pin', hostKey },
  })
})

test('a guest that lost its keys is vouched for when the operator confirms', async ({
  page,
}) => {
  await page.goto(pairingUrl())
  await page
    .getByRole('dialog', { name: 'Have you been here before?' })
    .getByRole('button', { name: 'Sam' })
    .click()
  const rejoin = page.getByRole('dialog', { name: 'Welcome back, Sam' })
  await expect(rejoin).toBeVisible()

  // The operator sees the request and says yes. The guest is polling.
  await expect
    .poll(async () => (await hostPendingVouches()).map((p) => p.personName))
    .toEqual(['Sam'])
  const [request] = await hostPendingVouches()
  expect(await confirmHostVouch(request.id)).toBe(true)

  await expect(rejoin).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('a vouched guest restores its person key from a photo of the backup', async ({
  page,
}) => {
  test.skip(!backup, 'Needs the backup the first test made')
  await page.goto(pairingUrl())
  await page
    .getByRole('dialog', { name: 'Have you been here before?' })
    .getByRole('button', { name: 'Sam' })
    .click()
  const rejoin = page.getByRole('dialog', { name: 'Welcome back, Sam' })
  await rejoin.getByLabel('Your PIN').fill('4821')
  await rejoin.getByRole('button', { name: 'Use PIN' }).click()
  await expect(rejoin).toHaveCount(0)
  const vouch = (await readKeyRecord(page, 'vouch')) as {
    payload: { personKey: string; deviceKey: string }
  }

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(
    page.getByText('This device has no person key. Tapes host vouched for it.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Restore from a backup' }).click()
  const restore = page.getByRole('dialog', { name: 'Restore your person key' })
  await restore.getByLabel(/Choose the backup file/).setInputFiles({
    name: 'backup-photo.png',
    mimeType: 'image/png',
    buffer: backup!.qrCode,
  })
  await restore.getByLabel('Your passphrase').fill(backup!.passphrase)
  await restore.getByRole('button', { name: 'Restore' }).click()

  await expect(restore).toHaveCount(0)
  await expect(
    page.getByText('This device has your person key, and it is backed up.'),
  ).toBeVisible()
  // The person key now certifies this device, and the vouch is gone.
  expect(await readKeyRecord(page, 'vouch')).toBeUndefined()
  expect(await readKeyRecord(page, 'person')).toMatchObject({
    certificate: {
      payload: {
        personKey: vouch.payload.personKey,
        deviceKey: vouch.payload.deviceKey,
      },
    },
  })
})

test('the operator withdraws a vouch the host gave the wrong person', async () => {
  // The vouch from the operator-confirm test above. The host kept it on the
  // roster, long after the request itself was dropped.
  const vouches = await hostSignedVouches()
  const vouch = vouches.find((each) => each.method === 'operator')
  expect(vouch).toMatchObject({ personName: 'Sam' })
  expect(vouch?.revokedAt).toBeUndefined()
  const address = vouch!.address

  // A recording of that device's, naming the vouch its claim was signed under.
  const tape = await seedRecording({ name: 'Wrong Sam', seconds: 1 })
  await listHostStatement(tape.url, address)
  // The peer's change travels over the socket. The host can only list a
  // revocation on a recording it has already seen name the vouch.
  await expect.poll(() => hostStatements(tape.url)).toContain(address)

  const result = await revokeHostVouch(address)
  if (!result.ok) {
    throw new Error(`Withdrawing the vouch failed: ${result.error}`)
  }
  expect(result.listedOn).toEqual([tape.url])

  // The revocation is on the recording, and the host holds its bytes, so a
  // reader fetching that recording's statements finds it.
  await expect.poll(() => peerStatements(tape.url)).toContain(result.address)
  expect(await hostObjects()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        hash: result.address,
        mimeType: STATEMENT_MIME_TYPE,
      }),
    ]),
  )

  // The roster says so too, and the same vouch cannot be withdrawn twice.
  expect(await hostSignedVouches()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ address, revokedAt: expect.any(String) }),
    ]),
  )
  expect(await revokeHostVouch(address)).toEqual({
    ok: false,
    error: 'already-revoked',
  })
})
