import { test, expect } from '@playwright/test'
import { disposeHost, hostRoster, startHost, PAIRING_TOKEN } from './host'

/**
 * A guest's first join puts the person on the host's roster, so the host can
 * vouch for their next device. The host signs, because vouching needs its key.
 *
 * Plain Playwright `test`, not the fixture: the fixture presses "Not now" on
 * the very prompt this spec fills in.
 */

let rootDocumentUrl: string

test.beforeAll(async () => {
  ;({ rootDocumentUrl } = await startHost({ signs: true }))
})

test.afterAll(async () => {
  await disposeHost()
})

test('a guest joins the host roster with a name and a PIN', async ({
  page,
}) => {
  await page.goto(
    `/?am=${encodeURIComponent(rootDocumentUrl)}&pt=${PAIRING_TOKEN}`,
  )

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
