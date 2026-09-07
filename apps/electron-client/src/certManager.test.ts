import https from 'https'
import path from 'path'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pki } from 'node-forge'

/**
 * The host is its own CA. These cover the shape the guest devices care about:
 * a root that can sign, a leaf that cannot, a leaf short enough for Apple to
 * accept, and a root that stays put when the LAN IP moves.
 */

const state = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
}))

const { ensureSyncServerCert, getSyncServerRootCertPem, isSyncServerCert } =
  await import('./certManager')

const DAY_MS = 24 * 60 * 60 * 1000

const certDir = () => path.join(state.userData, 'sync-tls')

/** The leaf and the root, in the order the server presents them. */
function parseChain(chain: string) {
  const pems = chain.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----\r?\n?/g,
  )
  return (pems ?? []).map((pem) => pki.certificateFromPem(pem))
}

const extension = (cert: pki.Certificate, name: string) =>
  cert.extensions.find((ext) => ext.name === name)

beforeEach(() => {
  state.userData = mkdtempSync(path.join(tmpdir(), 'tapes-certs-'))
})

afterEach(() => {
  rmSync(state.userData, { recursive: true, force: true })
})

describe('ensureSyncServerCert', () => {
  it('presents a leaf issued by a root that can sign', () => {
    const material = ensureSyncServerCert('192.168.1.20')
    const [leaf, root] = parseChain(material.cert)

    expect(parseChain(material.cert)).toHaveLength(2)
    expect(extension(root, 'basicConstraints')?.cA).toBe(true)
    expect(extension(root, 'keyUsage')?.keyCertSign).toBe(true)
    expect(extension(leaf, 'basicConstraints')?.cA).toBe(false)
    expect(extension(leaf, 'extKeyUsage')?.serverAuth).toBe(true)
    expect(root.verify(leaf)).toBe(true)
    expect(root.subject.hash).toBe(leaf.issuer.hash)
  })

  it('mints the root once and never serves its private key', () => {
    ensureSyncServerCert('192.168.1.20')

    const rootCert = readFileSync(
      path.join(certDir(), 'root-cert.pem'),
      'utf-8',
    )
    const chain = readFileSync(path.join(certDir(), 'cert.pem'), 'utf-8')

    expect(getSyncServerRootCertPem()).toBe(rootCert)
    expect(chain).not.toContain('PRIVATE KEY')
    expect(rootCert).not.toContain('PRIVATE KEY')
  })

  it('keeps the leaf inside the 825 day limit Apple enforces', () => {
    const [leaf] = parseChain(ensureSyncServerCert('192.168.1.20').cert)
    const days =
      (leaf.validity.notAfter.getTime() - leaf.validity.notBefore.getTime()) /
      DAY_MS

    expect(days).toBeLessThanOrEqual(825)
  })

  it('names the LAN IP, loopback and localhost in the leaf SAN', () => {
    const [leaf] = parseChain(ensureSyncServerCert('192.168.1.20').cert)
    const altNames = extension(leaf, 'subjectAltName')?.altNames as Array<{
      type: number
      value?: string
      ip?: string
    }>

    expect(altNames).toEqual([
      expect.objectContaining({ type: 2, value: 'localhost' }),
      expect.objectContaining({ type: 7, ip: '127.0.0.1' }),
      expect.objectContaining({ type: 7, ip: '192.168.1.20' }),
    ])
  })

  it('returns the same material while the LAN IP holds', () => {
    const first = ensureSyncServerCert('192.168.1.20')
    const second = ensureSyncServerCert('192.168.1.20')

    expect(second).toEqual(first)
  })

  it('re-issues the leaf for a new LAN IP and leaves the root alone', () => {
    const first = ensureSyncServerCert('192.168.1.20')
    const rootBefore = readFileSync(
      path.join(certDir(), 'root-cert.pem'),
      'utf-8',
    )
    const rootKeyBefore = readFileSync(
      path.join(certDir(), 'root-key.pem'),
      'utf-8',
    )

    const second = ensureSyncServerCert('10.0.0.5')
    const [newLeaf] = parseChain(second.cert)

    expect(second.cert).not.toBe(first.cert)
    expect(newLeaf.subject.getField('CN').value).toBe('10.0.0.5')
    expect(readFileSync(path.join(certDir(), 'root-cert.pem'), 'utf-8')).toBe(
      rootBefore,
    )
    expect(readFileSync(path.join(certDir(), 'root-key.pem'), 'utf-8')).toBe(
      rootKeyBefore,
    )
  })

  it('replaces a bare leaf left by an install that predates the root', () => {
    ensureSyncServerCert('192.168.1.20')
    const bareLeaf = parseChain(
      readFileSync(path.join(certDir(), 'cert.pem'), 'utf-8'),
    )[0]

    // What an older install left behind: a leaf and its meta, no root.
    rmSync(path.join(certDir(), 'root-cert.pem'))
    rmSync(path.join(certDir(), 'root-key.pem'))

    const [leaf, root] = parseChain(ensureSyncServerCert('192.168.1.20').cert)

    expect(leaf.serialNumber).not.toBe(bareLeaf.serialNumber)
    expect(root.verify(leaf)).toBe(true)
  })
})

describe('isSyncServerCert', () => {
  it('accepts a leaf our root issued', () => {
    const [leaf] = parseChain(ensureSyncServerCert('192.168.1.20').cert)

    expect(isSyncServerCert(pki.certificateToPem(leaf))).toBe(true)
  })

  it('still accepts the leaf after a LAN IP change re-issues it', () => {
    ensureSyncServerCert('192.168.1.20')
    const [reissued] = parseChain(ensureSyncServerCert('10.0.0.5').cert)

    expect(isSyncServerCert(pki.certificateToPem(reissued))).toBe(true)
  })

  it('rejects a certificate from another root', () => {
    ensureSyncServerCert('192.168.1.20')
    const stranger = parseChain(
      readFileSync(path.join(certDir(), 'root-cert.pem'), 'utf-8'),
    )
    rmSync(certDir(), { recursive: true })
    ensureSyncServerCert('192.168.1.20')

    expect(isSyncServerCert(pki.certificateToPem(stranger[0]))).toBe(false)
  })

  it('rejects anything that is not a certificate', () => {
    ensureSyncServerCert('192.168.1.20')

    expect(isSyncServerCert('not a pem')).toBe(false)
  })
})

describe('the chain the server presents', () => {
  it('validates with the root as the only trust anchor', async () => {
    const material = ensureSyncServerCert('127.0.0.1')
    const root = readFileSync(path.join(certDir(), 'root-cert.pem'), 'utf-8')

    const server = https.createServer(
      { key: material.key, cert: material.cert },
      (_request, response) => response.end('ok'),
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }

    // A guest that installed the root and nothing else. Node checks the
    // signature and the IP SAN, so this fails if either is wrong.
    const body = await new Promise<string>((resolve, reject) => {
      https
        .get({ host: '127.0.0.1', port, ca: root }, (response) => {
          let out = ''
          response.on('data', (chunk) => (out += chunk))
          response.on('end', () => resolve(out))
        })
        .on('error', reject)
    })
    server.close()

    expect(body).toBe('ok')
  })
})
