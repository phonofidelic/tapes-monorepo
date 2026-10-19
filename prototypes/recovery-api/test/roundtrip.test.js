// THROWAWAY PROTOTYPE (TAP-220). Run with `node --test`.
//
// Checks the store/fetch round trip over real HTTP, and that the wrap format
// decrypts only with the right PRF output. The PRF output is faked with random
// bytes, since no authenticator is available here.

import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createHandler } from '../src/server.js'
import { createStore, fileBackend } from '../src/store.js'
import {
  deriveKeys,
  toBase64Url,
  unwrapPersonKey,
  wrapPersonKey,
} from '../public/wrap.js'

let server
let base
let dataDir

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'recovery-api-'))
  server = createServer(createHandler(createStore(fileBackend(dataDir))))
  await new Promise((resolve) => server.listen(0, resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  server.close()
  await rm(dataDir, { recursive: true, force: true })
})

const randomId = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
const fakePrf = () => crypto.getRandomValues(new Uint8Array(32))

async function call(method, id, token, body) {
  const res = await fetch(`${base}/v1/backups/${id}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

async function makeBackup(prf, id) {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
  )
  const { wrapKey, authToken } = await deriveKeys(prf)
  const blob = await wrapPersonKey(wrapKey, id, pkcs8)
  return { pkcs8, authToken, blob }
}

test('a new device restores the same person key from the same PRF output', async () => {
  const prf = fakePrf()
  const id = randomId()
  const { pkcs8, authToken, blob } = await makeBackup(prf, id)

  assert.equal((await call('PUT', id, authToken, { blob })).status, 201)

  // The new device has only the passkey, so it derives everything again.
  const fresh = await deriveKeys(prf)
  const fetched = await call('GET', id, fresh.authToken)
  assert.equal(fetched.status, 200)
  const restored = await unwrapPersonKey(fresh.wrapKey, id, fetched.json.blob)
  assert.deepEqual(restored, pkcs8)
})

test('the stored file holds no key material the server could use', async () => {
  const prf = fakePrf()
  const id = randomId()
  const { pkcs8, authToken, blob } = await makeBackup(prf, id)
  await call('PUT', id, authToken, { blob })

  const files = await readdir(dataDir)
  const stored = await readFile(join(dataDir, `${id}.json`), 'utf8')
  assert.ok(files.includes(`${id}.json`))
  assert.ok(!stored.includes(authToken), 'auth token is stored only as a hash')
  assert.ok(!stored.includes(toBase64Url(pkcs8)), 'person key is not in clear')
})

test('a wrong token gets the same 404 as a missing backup', async () => {
  const id = randomId()
  const { authToken, blob } = await makeBackup(fakePrf(), id)
  await call('PUT', id, authToken, { blob })

  const other = await deriveKeys(fakePrf())
  assert.equal((await call('GET', id, other.authToken)).status, 404)
  assert.equal((await call('GET', randomId(), authToken)).status, 404)
})

test('only the owner can replace or delete a backup', async () => {
  const prf = fakePrf()
  const id = randomId()
  const { authToken, blob } = await makeBackup(prf, id)
  await call('PUT', id, authToken, { blob })

  const other = await deriveKeys(fakePrf())
  assert.equal((await call('PUT', id, other.authToken, { blob })).status, 403)
  assert.equal((await call('DELETE', id, other.authToken)).status, 404)
  assert.equal((await call('PUT', id, authToken, { blob })).status, 200)
  assert.equal((await call('DELETE', id, authToken)).status, 204)
  assert.equal((await call('GET', id, authToken)).status, 404)
})

test('a blob does not decrypt with another PRF output or another credential id', async () => {
  const prf = fakePrf()
  const id = randomId()
  const { blob } = await makeBackup(prf, id)

  const wrong = await deriveKeys(fakePrf())
  await assert.rejects(unwrapPersonKey(wrong.wrapKey, id, blob))
  const right = await deriveKeys(prf)
  await assert.rejects(unwrapPersonKey(right.wrapKey, randomId(), blob))
})

test('malformed requests are rejected', async () => {
  const id = randomId()
  const { authToken } = await deriveKeys(fakePrf())
  assert.equal(
    (await call('PUT', id, authToken, { blob: { v: 9 } })).status,
    400,
  )
  assert.equal((await call('GET', id, 'short')).status, 400)
  assert.equal((await call('GET', 'bad', authToken)).status, 400)
})
