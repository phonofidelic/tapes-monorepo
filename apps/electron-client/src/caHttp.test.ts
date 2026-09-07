import http from 'http'
import { AddressInfo } from 'net'
import { afterEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync, randomBytes } from 'crypto'
import { md, pki } from 'node-forge'
import { fingerprintFromPem } from './certFingerprint'
import {
  CA_CERT_CONTENT_TYPE,
  CA_CERT_PATH,
  TRUST_PAGE_PATH,
  createCaRequestHandler,
} from './caHttp'

/**
 * The guest-facing half of the host CA. What matters here is that a browser
 * asking for the root gets the root and nothing else: never the private key,
 * and never the app shell the SPA fallback would otherwise hand back.
 */

function selfSignedPem(): { cert: string; key: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const name = [{ name: 'commonName', value: 'Tapes Host CA' }]
  const cert = pki.createCertificate()
  cert.publicKey = pki.publicKeyFromPem(publicKey)
  cert.serialNumber = `00${randomBytes(8).toString('hex')}`
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)
  cert.setSubject(name)
  cert.setIssuer(name)
  cert.setExtensions([{ name: 'basicConstraints', critical: true, cA: true }])
  cert.sign(pki.privateKeyFromPem(privateKey), md.sha256.create())
  return { cert: pki.certificateToPem(cert), key: privateKey }
}

let server: http.Server | undefined

afterEach(async () => {
  if (server) {
    const running = server
    server = undefined
    await new Promise<void>((resolve) => running.close(() => resolve()))
  }
})

async function startForTest(rootCertPem?: string) {
  const handleCaRequest = createCaRequestHandler({ rootCertPem })
  server = http.createServer(async (request, response) => {
    if (await handleCaRequest(request, response)) {
      return
    }
    // Stands in for the SPA fallback, which answers every unmatched path with
    // a 200 and HTML. A route that declined when it should not have shows up
    // in these tests as this body rather than as a 404.
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<html>app shell</html>')
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

describe('createCaRequestHandler', () => {
  describe(CA_CERT_PATH, () => {
    it('returns the root certificate with the content type that triggers an install', async () => {
      const { cert } = selfSignedPem()
      const origin = await startForTest(cert)

      const response = await fetch(`${origin}${CA_CERT_PATH}`)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(CA_CERT_CONTENT_TYPE)
      await expect(response.text()).resolves.toBe(cert)
    })

    // The whole point of the route is that a guest can reach it before it
    // trusts anything about this host, so it must not depend on the token.
    it('needs no pairing token', async () => {
      const { cert } = selfSignedPem()
      const origin = await startForTest(cert)

      const response = await fetch(`${origin}${CA_CERT_PATH}`, {
        headers: { authorization: '' },
      })

      expect(response.status).toBe(200)
    })

    it('serves no key material', async () => {
      const { cert, key } = selfSignedPem()
      const origin = await startForTest(cert)

      const body = await (await fetch(`${origin}${CA_CERT_PATH}`)).text()

      expect(body).not.toContain('PRIVATE KEY')
      expect(body).not.toContain(key.trim())
      expect(body.match(/-----BEGIN /g)).toEqual(['-----BEGIN '])
    })

    // Without this the SPA fallback answers, and the browser tries to install
    // a page of HTML as a certificate authority.
    it('claims the path even with no certificate, rather than falling through', async () => {
      const origin = await startForTest(undefined)

      const response = await fetch(`${origin}${CA_CERT_PATH}`)

      expect(response.status).toBe(503)
      expect(response.headers.get('content-type')).toContain('application/json')
    })

    it('rejects a write to the route', async () => {
      const { cert } = selfSignedPem()
      const origin = await startForTest(cert)

      const response = await fetch(`${origin}${CA_CERT_PATH}`, {
        method: 'POST',
      })

      expect(response.status).toBe(405)
    })
  })

  describe(TRUST_PAGE_PATH, () => {
    it('prints the fingerprint of the certificate it is offering', async () => {
      const { cert } = selfSignedPem()
      const origin = await startForTest(cert)

      const body = await (await fetch(`${origin}${TRUST_PAGE_PATH}`)).text()

      expect(body).toContain(fingerprintFromPem(cert))
    })

    it('carries steps for every platform, not just the detected one', async () => {
      const { cert } = selfSignedPem()
      const origin = await startForTest(cert)

      const body = await (await fetch(`${origin}${TRUST_PAGE_PATH}`)).text()

      expect(body).toContain('Certificate Trust Settings')
      expect(body).toContain('Encryption and credentials')
      expect(body).toContain('Always Trust')
    })

    it('is answered by this route rather than the app shell', async () => {
      const origin = await startForTest(undefined)

      const response = await fetch(`${origin}${TRUST_PAGE_PATH}`)
      const body = await response.text()

      expect(response.status).toBe(200)
      expect(body).not.toContain('app shell')
      // A host with no certificate still serves the page, so the fallback
      // advice on it stays reachable, but it must not print a fingerprint.
      expect(body).toContain('No certificate has been created')
    })
  })

  it('declines paths it does not own', async () => {
    const { cert } = selfSignedPem()
    const origin = await startForTest(cert)

    const body = await (await fetch(`${origin}/library`)).text()

    expect(body).toContain('app shell')
  })
})

describe('fingerprintFromPem', () => {
  it('formats the digest the way trust-store UIs show it', () => {
    const { cert } = selfSignedPem()

    const fingerprint = fingerprintFromPem(cert)

    expect(fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
  })

  it('ignores the PEM line wrapping', () => {
    const { cert } = selfSignedPem()

    const rewrapped = cert
      .replace(/-----BEGIN CERTIFICATE-----\n/, '-----BEGIN CERTIFICATE-----\n')
      .replace(/\n(?!-----)/g, '')

    expect(fingerprintFromPem(rewrapped)).toBe(fingerprintFromPem(cert))
  })

  it('returns null for something that is not a certificate', () => {
    expect(fingerprintFromPem('-----BEGIN PRIVATE KEY-----\nabc\n')).toBeNull()
  })
})
