// THROWAWAY PROTOTYPE (TAP-217). Desktop smoke run, not a phone test.
//
// Drives the guest page in headless Chromium with a CDP virtual authenticator.
// It shows the code paths work end to end. It says nothing about iOS, Android
// or real password managers.
//
// The origins a.proto.test and b.proto.test stand for one host on two LAN
// IPs. They have separate IndexedDB stores and share the RP ID proto.test.
// Chromium maps them to 127.0.0.1 and treats them as secure for this run.
//
// Usage: see README.md, "Desktop smoke run".

import { chromium } from 'playwright-core'

const PORT = process.env.PROTO_PORT ?? '5190'
const ORIGIN_A = `http://a.proto.test:${PORT}`
const ORIGIN_B = `http://b.proto.test:${PORT}`
let query = '?rp=proto.test'
const A = () => `${ORIGIN_A}/${query}`
const B = () => `${ORIGIN_B}/${query}`

async function authenticator(page, credentials = []) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        ctap2Version: 'ctap2_1',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        hasPrf: true,
        automaticPresenceSimulation: true,
      },
    },
  )
  for (const credential of credentials) {
    await cdp.send('WebAuthn.addCredential', { authenticatorId, credential })
  }
  return { cdp, authenticatorId }
}

async function click(page, id) {
  await page.click(`#${id}`)
  await page.waitForFunction(() => !document.querySelector('button')?.disabled)
  await page.waitForTimeout(150)
}

async function lastLog(page, n = 3) {
  return page.$$eval(
    '#log li',
    (lis, n) => lis.slice(0, n).map((li) => li.textContent),
    n,
  )
}

async function scenario(browser, setup, recover) {
  console.log(`\n=== ${setup} / ${recover} ${query} ===`)
  await fetch(`http://localhost:${PORT}/proto-api/reset`, { method: 'POST' })

  const context = await browser.newContext()
  const page = await context.newPage()
  const { cdp, authenticatorId } = await authenticator(page)
  await page.goto(A())
  await click(page, setup)
  await click(page, 'record')
  console.log('origin A after setup:', await lastLog(page, 6))

  // IP change: same person, same synced passkey, new origin, empty store.
  await page.goto(B())
  await click(page, 'record')
  console.log('origin B before recovery:', (await lastLog(page, 2))[1])
  await click(page, recover)
  await click(page, 'record')
  console.log('origin B after recovery:', await lastLog(page, 4))

  // New phone: a fresh context and authenticator holding the synced passkey.
  // In Chromium 141 an imported virtual credential returns no PRF output, so
  // the PRF run fails at this step. That is a limit of the virtual
  // authenticator. Whether a synced passkey keeps its PRF on a new phone is
  // what the phone test has to show.
  const { credentials } = await cdp.send('WebAuthn.getCredentials', {
    authenticatorId,
  })
  const phone = await (await browser.newContext()).newPage()
  await authenticator(phone, credentials)
  await phone.goto(A())
  await click(phone, recover)
  await click(phone, 'record')
  console.log('new phone after recovery:', await lastLog(phone, 4))
  await context.close()
}

// CHROMIUM_PATH picks a local Chromium when Playwright's own build is missing.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--host-resolver-rules=MAP *.proto.test 127.0.0.1',
    `--unsafely-treat-insecure-origin-as-secure=${ORIGIN_A},${ORIGIN_B}`,
  ],
})
try {
  await scenario(browser, 'setup-passkey', 'recover-passkey')
  query = '?rp=proto.test&alg=es256'
  await scenario(browser, 'setup-passkey', 'recover-passkey')
  query = '?rp=proto.test'
  await scenario(browser, 'setup-prf', 'recover-prf')
} finally {
  await browser.close()
}
const claims = await (
  await fetch(`http://localhost:${PORT}/proto-api/claims`)
).json()
console.log('\nHost verdicts (newest first):')
for (const claim of claims) console.log(' ', claim.device, claim.verdict)
