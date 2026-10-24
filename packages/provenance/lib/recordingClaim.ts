/**
 * Builds the claim a recording device signs when recording stops, and the
 * text form a signed claim travels in on its way to the host.
 *
 * The device hashes its own bytes before calling this. The signature has to
 * cover what the recorder captured, not what the host later received.
 */

import { canonicalJson } from './canonicalJson'
import { fromBase64Url, toBase64Url } from './encoding'
import { exportPublicKey, signStatement } from './signing'
import { RECORDING_CLAIM_TYPE, type RecordingClaim, type Signed } from './types'

/** The session ID claims carry until the host records sessions. */
export const NO_SESSION_ID = 'unsessioned'

/** The HTTP header a guest sends its signed claim in, alongside the upload. */
export const RECORDING_CLAIM_HEADER = 'X-Tapes-Recording-Claim'

export async function createRecordingClaim(
  details: {
    blob: RecordingClaim['blob']
    startedAt: string
    endedAt: string
    sessionId?: string
    /** Address of this device's certificate, when it has one. */
    deviceCert?: string
  },
  keyPair: CryptoKeyPair,
): Promise<Signed<RecordingClaim>> {
  return signStatement(
    {
      type: RECORDING_CLAIM_TYPE,
      blob: details.blob,
      startedAt: details.startedAt,
      endedAt: details.endedAt,
      sessionId: details.sessionId ?? NO_SESSION_ID,
      deviceKey: await exportPublicKey(keyPair.publicKey),
      ...(details.deviceCert !== undefined && {
        deviceCert: details.deviceCert,
      }),
    },
    keyPair.privateKey,
  )
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

/**
 * A signed statement as one base64url string of its canonical JSON. It fits
 * in an HTTP header, and code that only carries it can treat it as opaque.
 */
export function encodeSignedStatement(signed: Signed<unknown>): string {
  return toBase64Url(encoder.encode(canonicalJson(signed)))
}

/**
 * Reverses `encodeSignedStatement`. Returns undefined for text that is not a
 * statement wrapper. The payload is not checked: it arrives from another
 * device, so verify it before trusting anything in it.
 */
export function decodeSignedStatement(
  text: string,
): Signed<unknown> | undefined {
  const bytes = fromBase64Url(text)
  return bytes && parseSignedStatement(bytes)
}

/**
 * Parses a statement as stored: the raw bytes of its JSON, as `statementBytes`
 * writes them. Like `decodeSignedStatement`, it checks only the wrapper. It
 * does not require canonical form, so compare against `statementBytes` where
 * that matters.
 */
export function parseSignedStatement(
  bytes: Uint8Array,
): Signed<unknown> | undefined {
  try {
    const value: unknown = JSON.parse(decoder.decode(bytes))
    const signed = value as Partial<Signed<unknown>> | null
    if (
      typeof signed !== 'object' ||
      signed === null ||
      Array.isArray(signed) ||
      typeof signed.signature !== 'string' ||
      !('payload' in signed)
    ) {
      return undefined
    }
    return { payload: signed.payload, signature: signed.signature }
  } catch {
    return undefined
  }
}

/** The payload's `type`, or undefined when the payload is not an object. */
export function statementType(signed: Signed<unknown>): unknown {
  const payload = signed.payload as { type?: unknown } | null
  return typeof payload === 'object' && payload !== null
    ? payload.type
    : undefined
}
