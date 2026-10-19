/**
 * THROWAWAY PROTOTYPE (TAP-217). Not production code.
 *
 * A stand-in for the desktop host, as Vite dev-server middleware under
 * /proto-api. It keeps what a host would keep for these flows: wrapped person
 * keys, passkey public keys, device certificates and recording claims. It
 * checks every certificate and claim with the same code the browser uses.
 * State lives in memory and in .data/state.json, which git ignores.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'
import {
  canonicalJson,
  sha256Hex,
  statementAddress,
  verifyStatement,
  type RecordingClaim,
  type Signed,
} from './src/provenance'
import { fingerprint, verifyCert, type AnyCert } from './src/certs'

type ClaimLog = {
  at: string
  device: string
  person?: string
  verdict: string
}

type State = {
  store: Record<string, unknown>
  /** Certificates by sha-256 of their canonical JSON. */
  certs: Record<string, AnyCert>
  claims: ClaimLog[]
}

export function protoHost(dataDir: string): Plugin {
  const file = path.join(dataDir, 'state.json')
  const state: State = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : { store: {}, certs: {}, claims: [] }
  const save = () => {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(file, JSON.stringify(state, null, 2))
  }

  return {
    name: 'tapes-proto-host',
    configureServer(server) {
      server.middlewares.use('/proto-api', (req, res) => {
        handle(req, res).catch((error) => {
          send(res, 500, { error: String(error) })
        })
      })
    },
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x')
    const route = url.pathname

    if (route === '/store/cert' && req.method === 'PUT') {
      const cert = (await body(req)) as AnyCert
      const check = await verifyCert(cert)
      if (!check.ok) {
        return send(res, 200, { ok: false, reason: check.reason })
      }
      const address = await sha256Hex(
        new TextEncoder().encode(canonicalJson(cert)),
      )
      state.certs[address] = cert
      save()
      return send(res, 200, { ok: true, address })
    }

    if (route.startsWith('/store/')) {
      const key = decodeURIComponent(route.slice('/store/'.length))
      if (req.method === 'PUT') {
        state.store[key] = await body(req)
        save()
        return send(res, 200, { ok: true })
      }
      return key in state.store
        ? send(res, 200, state.store[key])
        : send(res, 404, { error: 'not found' })
    }

    if (route === '/claim' && req.method === 'POST') {
      const claim = (await body(req)) as Signed<RecordingClaim>
      const entry: ClaimLog = {
        at: new Date().toISOString(),
        device: (await fingerprint(claim.payload.deviceKey)) ?? '?',
        verdict: '',
      }
      if (!(await verifyStatement(claim, claim.payload.deviceKey))) {
        entry.verdict = 'claim signature does not verify'
      } else if (!claim.payload.deviceCert) {
        entry.verdict = 'signed, but the device has no certificate (anonymous)'
      } else {
        const cert = state.certs[claim.payload.deviceCert]
        const check = cert ? await verifyCert(cert) : undefined
        if (!check?.ok) {
          entry.verdict = 'certificate missing or invalid'
        } else if (check.deviceKey !== claim.payload.deviceKey) {
          entry.verdict = 'certificate is for another device key'
        } else {
          entry.person = await fingerprint(check.personKey)
          entry.verdict = `linked to person ${entry.person}`
        }
      }
      state.claims.unshift(entry)
      save()
      return send(res, 200, {
        ...entry,
        address: await statementAddress(claim),
      })
    }

    if (route === '/claims') {
      return send(res, 200, state.claims.slice(0, 50))
    }

    if (route === '/reset' && req.method === 'POST') {
      state.store = {}
      state.certs = {}
      state.claims = []
      save()
      return send(res, 200, { ok: true })
    }

    send(res, 404, { error: 'unknown route' })
  }
}

function body(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let text = ''
    req.on('data', (chunk) => (text += chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(value))
}
