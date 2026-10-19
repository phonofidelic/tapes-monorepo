// @ts-check
// THROWAWAY PROTOTYPE (TAP-220). Not production code.
//
// A tiny HTTP service that stores an encrypted person-key backup per passkey,
// and serves the client page in ../public. Node built-ins only, no framework.
// Run it with `node src/server.js`. See the README for HTTPS and phones.

import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore, fileBackend } from './store.js'

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url))
const MAX_BODY_BYTES = 4096
const ID_PATTERN = /^[A-Za-z0-9_-]{16,1024}$/
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} [body]
 */
function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

/** @param {import('node:http').IncomingMessage} req */
async function readJson(req) {
  let size = 0
  /** @type {Buffer[]} */
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** @param {unknown} blob */
function isBlob(blob) {
  if (typeof blob !== 'object' || blob === null) return false
  const b = /** @type {Record<string, unknown>} */ (blob)
  return (
    b.v === 1 &&
    b.alg === 'A256GCM' &&
    typeof b.iv === 'string' &&
    typeof b.ct === 'string'
  )
}

/** @param {import('node:http').IncomingMessage} req */
function bearer(req) {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : undefined
}

/** @param {ReturnType<typeof createStore>} store */
export function createHandler(store) {
  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://local')
    const match = /^\/v1\/backups\/([^/]+)$/.exec(url.pathname)

    if (url.pathname === '/healthz') return send(res, 200, { ok: true })

    if (match) {
      const id = match[1]
      const token = bearer(req)
      if (!ID_PATTERN.test(id) || !token) return send(res, 400)

      if (req.method === 'PUT') {
        let body
        try {
          body = await readJson(req)
        } catch {
          return send(res, 400)
        }
        if (!isBlob(body?.blob)) return send(res, 400)
        const result = await store.save(id, token, body.blob)
        if (result === 'forbidden') return send(res, 403)
        return send(res, result === 'created' ? 201 : 200, { result })
      }
      if (req.method === 'GET') {
        const blob = await store.fetch(id, token)
        return blob ? send(res, 200, { blob }) : send(res, 404)
      }
      if (req.method === 'DELETE') {
        return send(res, (await store.remove(id, token)) ? 204 : 404)
      }
      return send(res, 405)
    }

    if (req.method === 'GET') return serveStatic(url.pathname, res)
    return send(res, 404)
  }
}

/**
 * @param {string} pathname
 * @param {import('node:http').ServerResponse} res
 */
async function serveStatic(pathname, res) {
  const relative = normalize(pathname === '/' ? '/index.html' : pathname)
  if (relative.includes('..')) return send(res, 404)
  try {
    const body = await readFile(join(PUBLIC_DIR, relative))
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(relative)] ?? 'text/plain',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    send(res, 404)
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const port = Number(process.env.PORT ?? 3040)
  const store = createStore(fileBackend(process.env.DATA_DIR ?? './data'))
  const handler = createHandler(store)
  const { TLS_KEY, TLS_CERT } = process.env
  // WebAuthn needs a secure context. Plain http is fine for localhost only.
  const server =
    TLS_KEY && TLS_CERT
      ? createHttpsServer(
          { key: readFileSync(TLS_KEY), cert: readFileSync(TLS_CERT) },
          handler,
        )
      : createHttpServer(handler)
  server.listen(port, () => {
    const scheme = TLS_KEY ? 'https' : 'http'
    console.log(`recovery-api prototype on ${scheme}://localhost:${port}`)
  })
}
