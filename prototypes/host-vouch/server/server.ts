/**
 * THROWAWAY PROTOTYPE (TAP-219). Not production code.
 *
 * A stand-in host for testing host vouching with real phones. Guests get their
 * page and API over HTTPS on the LAN. The operator page runs on a separate
 * loopback-only HTTP port that never moves. It does not run the real Electron
 * host or sync anything.
 *
 * "Simulate IP change" moves the guest server to the next port. A new port is
 * a new origin, so every guest loses its IndexedDB, as a new LAN IP does.
 */

import fs from 'fs'
import http from 'http'
import https from 'https'
import os from 'os'
import path from 'path'
import { generateKeyPairSync, randomBytes } from 'crypto'
import forge from 'node-forge'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QRCodeSVG } from 'qrcode.react'
import {
  exportPublicKey,
  generateSigningKeyPair,
  keyFingerprint,
  type Signed,
} from '@tapes-monorepo/provenance'
import {
  createHostVouching,
  emptyState,
  type HostVouchingState,
} from '../lib/hostVouching'
import { guestPage, hostPage } from './pages'

const ED25519 = { name: 'Ed25519' }

// node-forge is CommonJS. The bundled ESM server can only take its default.
const { md, pki } = forge

type Options = {
  dataDir: string
  guestScript: string
  port: number
  operatorPort: number
}

// ---------------------------------------------------------------------------
// Host key and state. A JSON file stands in for the OS keychain.

async function loadHostKey(dataDir: string): Promise<CryptoKeyPair> {
  const file = path.join(dataDir, 'host-key.json')
  let jwk: JsonWebKey
  if (fs.existsSync(file)) {
    jwk = JSON.parse(fs.readFileSync(file, 'utf-8')) as JsonWebKey
  } else {
    const generated = await generateSigningKeyPair(true)
    jwk = await crypto.subtle.exportKey('jwk', generated.privateKey)
    fs.writeFileSync(file, JSON.stringify(jwk), { mode: 0o600 })
  }
  const { kty, crv, x } = jwk
  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.importKey('jwk', jwk, ED25519, false, ['sign']),
    crypto.subtle.importKey('jwk', { kty, crv, x }, ED25519, true, ['verify']),
  ])
  return { privateKey, publicKey }
}

function loadState(dataDir: string): HostVouchingState {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(dataDir, 'state.json'), 'utf-8'),
    ) as HostVouchingState
  } catch {
    return emptyState()
  }
}

function saveState(dataDir: string, state: HostVouchingState) {
  fs.writeFileSync(
    path.join(dataDir, 'state.json'),
    JSON.stringify(state, null, 2),
  )
}

// ---------------------------------------------------------------------------
// TLS. WebCrypto needs a secure context, so guests must load over HTTPS. A
// throwaway self-signed certificate is enough: guests tap through the warning.

function lanIps(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(
      (net): net is os.NetworkInterfaceInfo =>
        !!net && net.family === 'IPv4' && !net.internal,
    )
    .map((net) => net.address)
}

function selfSignedCert(ips: string[]) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const cert = pki.createCertificate()
  cert.publicKey = pki.publicKeyFromPem(publicKey)
  cert.serialNumber = `00${randomBytes(16).toString('hex')}`
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date(Date.now() + 7 * 24 * 3600_000)
  const name = [{ name: 'commonName', value: 'Tapes vouch prototype' }]
  cert.setSubject(name)
  cert.setIssuer(name)
  cert.setExtensions([
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        ...ips.map((ip) => ({ type: 7, ip })),
      ],
    },
  ])
  cert.sign(pki.privateKeyFromPem(privateKey), md.sha256.create())
  return { key: privateKey, cert: pki.certificateToPem(cert) }
}

// ---------------------------------------------------------------------------
// HTTP helpers.

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > 64 * 1024) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
}

function send(
  response: http.ServerResponse,
  status: number,
  body: unknown,
  type = 'application/json',
) {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  })
  response.end(typeof body === 'string' ? body : JSON.stringify(body))
}

function isSigned(value: unknown): value is Signed<unknown> {
  const signed = value as Partial<Signed<unknown>> | null
  return (
    typeof signed === 'object' &&
    signed !== null &&
    'payload' in signed &&
    typeof signed.signature === 'string'
  )
}

// ---------------------------------------------------------------------------

export async function startPrototype({
  dataDir,
  guestScript,
  port,
  operatorPort,
}: Options) {
  fs.mkdirSync(dataDir, { recursive: true })
  const hostKeyPair = await loadHostKey(dataDir)
  const hostKey = await exportPublicKey(hostKeyPair.publicKey)
  const hostFingerprint = (await keyFingerprint(hostKey)) ?? '?'
  const state = loadState(dataDir)
  const vouching = createHostVouching({ state, hostKeyPair })
  const save = () => saveState(dataDir, state)

  let ips = lanIps()
  let tls = selfSignedCert(ips)
  let lanIp = ips[0] ?? '127.0.0.1'

  let currentPort = port
  let server: https.Server | undefined
  let originChanges = 0

  const guestUrl = () => `https://${lanIp}:${currentPort}/?hk=${hostKey}`

  async function handleGuest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) {
    const url = new URL(request.url ?? '/', 'https://localhost')
    const method = request.method ?? 'GET'
    const route = `${method} ${url.pathname}`
    if (route === 'GET /') {
      return send(response, 200, guestPage(), 'text/html; charset=utf-8')
    }
    if (route === 'GET /guest.js') {
      return send(response, 200, guestScript, 'text/javascript')
    }
    if (route === 'GET /api/roster') {
      return send(response, 200, { hostKey, people: vouching.roster() })
    }
    if (route === 'POST /api/enroll') {
      const body = (await readJson(request)) as {
        cert?: unknown
        name?: unknown
        pin?: unknown
      }
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!isSigned(body.cert) || !name || name.length > 40) {
        return send(response, 400, { error: 'bad-request' })
      }
      const result = await vouching.enroll(
        body.cert,
        name,
        typeof body.pin === 'string' ? body.pin : undefined,
      )
      if (result.ok) save()
      return send(response, result.ok ? 200 : 400, result)
    }
    if (route === 'POST /api/requests') {
      const body = await readJson(request)
      if (!isSigned(body)) {
        return send(response, 400, { error: 'bad-request' })
      }
      const result = await vouching.request(body)
      if (result.ok) save()
      return send(response, result.ok ? 200 : 400, result)
    }
    const requestMatch = url.pathname.match(
      /^\/api\/requests\/([\w-]+)(\/pin)?$/,
    )
    if (requestMatch && method === 'GET' && !requestMatch[2]) {
      const entry = vouching.get(requestMatch[1])
      if (!entry) return send(response, 404, { error: 'not-found' })
      return send(response, 200, { status: entry.status, vouch: entry.vouch })
    }
    if (requestMatch && method === 'POST' && requestMatch[2]) {
      const body = (await readJson(request)) as { pin?: unknown }
      const result = await vouching.enterPin(
        requestMatch[1],
        typeof body.pin === 'string' ? body.pin : '',
      )
      save()
      return send(response, result.ok ? 200 : 400, result)
    }
    send(response, 404, { error: 'not-found' })
  }

  // The operator sits at the host. This server listens on loopback only.
  async function handleOperator(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const route = `${request.method ?? 'GET'} ${url.pathname}`
    if (route === 'GET /' || route === 'GET /host') {
      return send(response, 200, hostPage(), 'text/html; charset=utf-8')
    }
    if (route === 'GET /host/api/state') {
      return send(response, 200, {
        hostFingerprint,
        guestUrl: guestUrl(),
        qr: renderToStaticMarkup(
          createElement(QRCodeSVG, { value: guestUrl(), size: 240 }),
        ),
        port: currentPort,
        originChanges,
        people: vouching.roster(),
        pending: vouching.pending().map((entry) => ({
          id: entry.id,
          personKey: entry.request.payload.personKey,
          personName: entry.personName,
          deviceLabel: entry.request.payload.deviceLabel,
          deviceFingerprint: entry.deviceFingerprint,
          receivedAt: entry.receivedAt,
        })),
        log: state.log,
      })
    }
    const body = (await readJson(request)) as {
      id?: string
      personKey?: string
    }
    if (route === 'POST /host/api/confirm' && body.id) {
      const vouch = await vouching.confirm(body.id)
      save()
      return send(response, vouch ? 200 : 404, { ok: !!vouch })
    }
    if (route === 'POST /host/api/reject' && body.id) {
      vouching.reject(body.id)
      save()
      return send(response, 200, { ok: true })
    }
    if (route === 'POST /host/api/unlock-pin' && body.personKey) {
      vouching.unlockPin(body.personKey)
      return send(response, 200, { ok: true })
    }
    if (route === 'POST /host/api/change-origin') {
      // Picks up a real network change too. The port always moves, so the
      // origin is new even when the IP is the same.
      ips = lanIps()
      tls = selfSignedCert(ips)
      lanIp = ips[0] ?? '127.0.0.1'
      await listen(currentPort + 1)
      originChanges++
      return send(response, 200, { ok: true, port: currentPort })
    }
    if (route === 'POST /host/api/reset') {
      Object.assign(state, emptyState())
      save()
      return send(response, 200, { ok: true })
    }
    send(response, 404, { error: 'not-found' })
  }

  // Closes the old guest server first, so its origin stops answering.
  async function listen(nextPort: number) {
    if (server) {
      const old = server
      old.closeAllConnections()
      await new Promise<void>((resolve) => old.close(() => resolve()))
    }
    server = https.createServer(tls, wrap(handleGuest))
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject)
      server!.listen(nextPort, '0.0.0.0', () => resolve())
    })
    currentPort = nextPort
    console.log(`\nGuests now use: ${guestUrl()}`)
  }

  const wrap =
    (
      handler: (
        request: http.IncomingMessage,
        response: http.ServerResponse,
      ) => Promise<void>,
    ) =>
    (request: http.IncomingMessage, response: http.ServerResponse) => {
      handler(request, response).catch((error: unknown) => {
        console.error(error)
        if (!response.headersSent) send(response, 500, { error: 'server' })
      })
    }

  await listen(port)
  const operator = http.createServer(wrap(handleOperator))
  await new Promise<void>((resolve, reject) => {
    operator.once('error', reject)
    operator.listen(operatorPort, '127.0.0.1', () => resolve())
  })
  console.log(`Operator page: http://localhost:${operatorPort}/`)
  console.log(`Host key fingerprint: ${hostFingerprint}`)
}
