import { test, expect } from '@playwright/test'
import {
  confirmHostVouch,
  disposeHost,
  hostPendingVouches,
  hostRoster,
  startHost,
  PAIRING_TOKEN,
} from './host'

/**
 * A guest's first join puts the person on the host's roster. A later guest
 * with no keys, as after the host's IP changed, picks that person and the
 * host vouches for it. The host signs, because vouching needs its key.
 *
 * Each test gets a fresh browser context, which is a device with no keys. The
 * second test needs the person the first one added, so they run in order.
 *
 * Plain Playwright `test`, not the fixture: the fixture presses "Not now" on
 * the very prompt this spec fills in.
 */

test.describe.configure({ mode: 'serial' })

let rootDocumentUrl: string
let hostKey: string | undefined

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
  await expect(
    page.getByRole('dialog', { name: 'Back up your person key' }),
  ).toBeVisible()
  await expect(join).toHaveCount(0)
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
  const vouch = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('tapes-provenance')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const get = open.result
            .transaction('keys')
            .objectStore('keys')
            .get('vouch')
          get.onsuccess = () => resolve(get.result)
          get.onerror = () => reject(get.error)
        }
      }),
  )
  expect(vouch).toMatchObject({
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
