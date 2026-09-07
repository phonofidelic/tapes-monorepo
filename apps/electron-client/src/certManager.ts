import path from 'path'
import { generateKeyPairSync, randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'
import { md, pki } from 'node-forge'

/**
 * TLS material for the embedded sync server. The host is its own certificate
 * authority: it mints a root once per install and issues the server leaf from
 * that root. A guest who installs the root trusts every leaf minted afterwards,
 * so a change of LAN IP no longer produces a new browser warning. Both
 * certificates live under `userData/sync-tls`, and the root's private key never
 * leaves that directory.
 */
export type TlsMaterial = {
  key: string
  /** The chain the server presents: the leaf first, then the root. */
  cert: string
}

const certDir = () => path.join(app.getPath('userData'), 'sync-tls')
const rootKeyPath = () => path.join(certDir(), 'root-key.pem')
const rootCertPath = () => path.join(certDir(), 'root-cert.pem')
const keyPath = () => path.join(certDir(), 'key.pem')
const certPath = () => path.join(certDir(), 'cert.pem')
const metaPath = () => path.join(certDir(), 'cert-meta.json')

const ROOT_DAYS = 3650

// Apple rejects a server certificate valid for longer than 825 days, and holds
// some certificates to a 398-day limit. 397 days clears both.
const LEAF_DAYS = 397

// Re-issue the leaf once it is this close to expiring.
const LEAF_RENEW_MS = 30 * 24 * 60 * 60 * 1000

// What the persisted leaf was minted for, so we know when to replace it. The
// LAN IP must be in the SAN for https://<lan-ip> to validate.
type CertMeta = { lanIp?: string; notAfter?: string }

function readMeta(): CertMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath(), 'utf-8')) as CertMeta
  } catch {
    return null
  }
}

function newKeyPair() {
  // Node's native RSA keygen, not node-forge's. Forge generates keys in pure JS
  // and takes seconds to do it. It still builds and signs the certificates.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  return {
    privateKeyPem: privateKey,
    privateKey: pki.privateKeyFromPem(privateKey),
    publicKey: pki.publicKeyFromPem(publicKey),
  }
}

// A serial whose leading byte is above 0x7f reads as negative, which RFC 5280
// forbids. The zero byte in front keeps every serial positive.
const newSerialNumber = () => `00${randomBytes(16).toString('hex')}`

function validity(days: number) {
  const notBefore = new Date()
  const notAfter = new Date(notBefore)
  notAfter.setDate(notAfter.getDate() + days)
  return { notBefore, notAfter }
}

function mintRoot(): { key: string; cert: string } {
  const { privateKeyPem, privateKey, publicKey } = newKeyPair()
  const name: pki.CertificateField[] = [
    { name: 'commonName', value: 'Tapes Host CA' },
    { name: 'organizationName', value: 'Tapes' },
  ]

  const cert = pki.createCertificate()
  cert.publicKey = publicKey
  cert.serialNumber = newSerialNumber()
  Object.assign(cert.validity, validity(ROOT_DAYS))
  cert.setSubject(name)
  cert.setIssuer(name)
  cert.setExtensions([
    { name: 'basicConstraints', critical: true, cA: true },
    { name: 'keyUsage', critical: true, keyCertSign: true, cRLSign: true },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(privateKey, md.sha256.create())

  return { key: privateKeyPem, cert: pki.certificateToPem(cert) }
}

function issueLeaf(
  root: { key: string; cert: string },
  lanIp: string | undefined,
): { key: string; cert: string; notAfter: Date } {
  const rootCert = pki.certificateFromPem(root.cert)
  const rootKey = pki.privateKeyFromPem(root.key)

  // type 2 = DNS name, type 7 = IP address (see node-forge altNames).
  const altNames: Array<{ type: number; value?: string; ip?: string }> = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
  ]
  if (lanIp) {
    altNames.push({ type: 7, ip: lanIp })
  }

  const { privateKeyPem, publicKey } = newKeyPair()
  const period = validity(LEAF_DAYS)

  const cert = pki.createCertificate()
  cert.publicKey = publicKey
  cert.serialNumber = newSerialNumber()
  Object.assign(cert.validity, period)
  cert.setSubject([
    { name: 'commonName', value: lanIp ?? 'localhost' },
    { name: 'organizationName', value: 'Tapes' },
  ])
  cert.setIssuer(rootCert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', critical: true, cA: false },
    {
      name: 'keyUsage',
      critical: true,
      digitalSignature: true,
      keyEncipherment: true,
    },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
    { name: 'subjectKeyIdentifier' },
    {
      // Forge fills this from the certificate being signed unless we hand it
      // the issuer's identifier, so pass the root's explicitly.
      name: 'authorityKeyIdentifier',
      keyIdentifier: rootCert.generateSubjectKeyIdentifier().getBytes(),
    },
  ])
  cert.sign(rootKey, md.sha256.create())

  return {
    key: privateKeyPem,
    cert: pki.certificateToPem(cert),
    notAfter: period.notAfter,
  }
}

function ensureRoot(): { key: string; cert: string; minted: boolean } {
  if (existsSync(rootKeyPath()) && existsSync(rootCertPath())) {
    return {
      key: readFileSync(rootKeyPath(), 'utf-8'),
      cert: readFileSync(rootCertPath(), 'utf-8'),
      minted: false,
    }
  }

  const root = mintRoot()
  writeFileSync(rootKeyPath(), root.key, { mode: 0o600 })
  writeFileSync(rootCertPath(), root.cert)
  return { ...root, minted: true }
}

function leafIsCurrent(meta: CertMeta | null, lanIp: string | undefined) {
  if (!existsSync(keyPath()) || !existsSync(certPath())) return false
  if (!meta || meta.lanIp !== lanIp || !meta.notAfter) return false
  const notAfter = Date.parse(meta.notAfter)
  return Number.isFinite(notAfter) && notAfter - Date.now() > LEAF_RENEW_MS
}

/**
 * Returns the key and certificate chain for the embedded sync server. The root
 * is minted on first run and then left alone. The leaf is re-issued when the
 * LAN IP changes and when it is within a month of expiring. Installs made
 * before this had a bare self-signed leaf and no root, so their first launch
 * mints the root and replaces the leaf.
 */
export function ensureSyncServerCert(lanIp: string | undefined): TlsMaterial {
  mkdirSync(certDir(), { recursive: true })

  const root = ensureRoot()
  const meta = readMeta()

  if (!root.minted && leafIsCurrent(meta, lanIp)) {
    return {
      key: readFileSync(keyPath(), 'utf-8'),
      cert: readFileSync(certPath(), 'utf-8'),
    }
  }

  const leaf = issueLeaf(root, lanIp)
  const chain = `${leaf.cert}${root.cert}`
  writeFileSync(keyPath(), leaf.key, { mode: 0o600 })
  writeFileSync(certPath(), chain)
  writeFileSync(
    metaPath(),
    JSON.stringify({ lanIp, notAfter: leaf.notAfter.toISOString() }, null, 2),
  )
  return { key: leaf.key, cert: chain }
}

/** The root certificate PEM, or null if none has been minted yet. */
export function getSyncServerRootCertPem(): string | null {
  try {
    return readFileSync(rootCertPath(), 'utf-8')
  } catch {
    return null
  }
}

/**
 * True when `pem` is a certificate our root issued. The main process uses this
 * to trust the loopback connection from its own renderer. Checking against the
 * root rather than the leaf keeps that connection working after the leaf is
 * re-issued for a new LAN IP, with no restart.
 */
export function isSyncServerCert(pem: string): boolean {
  const rootPem = getSyncServerRootCertPem()
  if (!rootPem) return false
  try {
    const store = pki.createCaStore([pki.certificateFromPem(rootPem)])
    return pki.verifyCertificateChain(store, [pki.certificateFromPem(pem)])
  } catch {
    return false
  }
}
