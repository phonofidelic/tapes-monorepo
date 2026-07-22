import path from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'
import { generate } from 'selfsigned'

export type TlsMaterial = { key: string; cert: string }

const certDir = () => path.join(app.getPath('userData'), 'sync-tls')
const keyPath = () => path.join(certDir(), 'key.pem')
const certPath = () => path.join(certDir(), 'cert.pem')
const metaPath = () => path.join(certDir(), 'cert-meta.json')

// The LAN IP the persisted cert was minted for, so we can regenerate when it
// changes (the IP must be in the SAN for https://<lan-ip> to validate).
type CertMeta = { lanIp?: string }

function readMeta(): CertMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath(), 'utf-8')) as CertMeta
  } catch {
    return null
  }
}

async function generateCert(lanIp: string | undefined): Promise<TlsMaterial> {
  // type 2 = DNS name, type 7 = IP address (see selfsigned SubjectAltName).
  const altNames = [
    { type: 2 as const, value: 'localhost' },
    { type: 7 as const, ip: '127.0.0.1' },
  ]
  if (lanIp) {
    altNames.push({ type: 7 as const, ip: lanIp })
  }

  const notBeforeDate = new Date()
  const notAfterDate = new Date(notBeforeDate)
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 10)

  const pems = await generate(
    [{ name: 'commonName', value: lanIp ?? 'localhost' }],
    {
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate,
      notAfterDate,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'subjectAltName', altNames },
      ],
    },
  )

  return { key: pems.private, cert: pems.cert }
}

/**
 * Returns the TLS key+cert for the embedded sync server, generating and
 * persisting a self-signed cert on first run and regenerating it when the LAN
 * IP changes. Persisting the cert means a guest's accepted browser exception
 * survives app restarts. `key.pem`/`cert.pem` live under `userData/sync-tls`.
 */
export async function ensureSyncServerCert(
  lanIp: string | undefined,
): Promise<TlsMaterial> {
  mkdirSync(certDir(), { recursive: true })

  const meta = readMeta()
  if (existsSync(keyPath()) && existsSync(certPath()) && meta?.lanIp === lanIp) {
    return {
      key: readFileSync(keyPath(), 'utf-8'),
      cert: readFileSync(certPath(), 'utf-8'),
    }
  }

  const material = await generateCert(lanIp)
  writeFileSync(keyPath(), material.key)
  writeFileSync(certPath(), material.cert)
  writeFileSync(metaPath(), JSON.stringify({ lanIp }, null, 2))
  return material
}

/**
 * The persisted sync-server cert PEM, or null if none has been generated yet.
 * Used by the main process to trust exactly this cert when the host's own
 * renderer connects to the embedded server over `wss://127.0.0.1`.
 */
export function getSyncServerCertPem(): string | null {
  try {
    return readFileSync(certPath(), 'utf-8')
  } catch {
    return null
  }
}
