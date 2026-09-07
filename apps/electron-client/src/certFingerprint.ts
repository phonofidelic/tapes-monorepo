import { createHash } from 'crypto'

/**
 * SHA-256 of a certificate's DER bytes, uppercase hex in colon-separated pairs
 * — the form `openssl x509 -fingerprint -sha256` prints and the form every OS
 * trust-store UI shows.
 *
 * A guest downloads the host's root over a connection nothing has vouched for
 * yet, so the download on its own proves nothing. Comparing this string against
 * the one the host shows is what makes the install safe.
 *
 * This lives apart from certManager.ts because the HTTP route that prints the
 * fingerprint runs in tests with no Electron `app` to read a userData path
 * from. Returns null for input that is not a certificate.
 */
export function fingerprintFromPem(pem: string): string | null {
  // Hash the DER, not the PEM text: the line wrapping and any headers around
  // the base64 differ between producers, and trust-store UIs fingerprint DER.
  const match = pem.match(
    /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/,
  )
  const body = match?.[1].replace(/\s+/g, '')
  if (!body) return null
  const der = Buffer.from(body, 'base64')
  if (der.length === 0) return null
  const digest = createHash('sha256').update(der).digest('hex').toUpperCase()
  return digest.match(/.{2}/g)?.join(':') ?? null
}
