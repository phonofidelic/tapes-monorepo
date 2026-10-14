/**
 * The record a host signs when a session closes: which proven device keys were
 * connected and when, and which recording claims it accepted for the session.
 *
 * Every time in the record comes from the host's clock. Device clocks can be
 * set to anything, so they never decide a span or an accepted claim.
 */

import { exportPublicKey, signStatement, verifyStatement } from './signing'
import {
  SESSION_RECORD_TYPE,
  type SessionDevice,
  type SessionRecord,
  type SessionSpan,
  type Signed,
} from './types'

export async function createSessionRecord(
  details: {
    sessionId: string
    openedAt: Date
    closedAt: Date
    devices: SessionDevice[]
    claims: string[]
  },
  hostKeyPair: CryptoKeyPair,
): Promise<Signed<SessionRecord>> {
  return signStatement(
    {
      type: SESSION_RECORD_TYPE,
      sessionId: details.sessionId,
      openedAt: details.openedAt.toISOString(),
      closedAt: details.closedAt.toISOString(),
      devices: [...details.devices]
        .map((device) => ({ ...device, spans: sortSpans(device.spans) }))
        .sort((a, b) => compare(a.deviceKey, b.deviceKey)),
      claims: [...new Set(details.claims)].sort(compare),
      hostKey: await exportPublicKey(hostKeyPair.publicKey),
    },
    hostKeyPair.privateKey,
  )
}

/** Why a session record did not verify. */
export type SessionRecordProblem = 'malformed' | 'bad-signature'

export type SessionRecordCheck =
  | { ok: true; record: Signed<SessionRecord> }
  | { ok: false; problem: SessionRecordProblem }

/**
 * Checks a record's shape and that it verifies against the host key it names.
 * Like `checkHostReceipt`, this proves some key signed it, not which host.
 */
export async function checkSessionRecord(
  signed: Signed<unknown>,
): Promise<SessionRecordCheck> {
  const { payload } = signed
  if (!isSessionRecord(payload)) {
    return { ok: false, problem: 'malformed' }
  }
  if (!(await verifyStatement(signed, payload.hostKey))) {
    return { ok: false, problem: 'bad-signature' }
  }
  return { ok: true, record: { payload, signature: signed.signature } }
}

function isSessionRecord(payload: unknown): payload is SessionRecord {
  const record = payload as Partial<SessionRecord> | null
  return (
    typeof record === 'object' &&
    record !== null &&
    record.type === SESSION_RECORD_TYPE &&
    typeof record.sessionId === 'string' &&
    typeof record.openedAt === 'string' &&
    typeof record.closedAt === 'string' &&
    typeof record.hostKey === 'string' &&
    Array.isArray(record.claims) &&
    record.claims.every((claim) => typeof claim === 'string') &&
    Array.isArray(record.devices) &&
    record.devices.every(isSessionDevice)
  )
}

function isSessionDevice(value: unknown): value is SessionDevice {
  const device = value as Partial<SessionDevice> | null
  return (
    typeof device === 'object' &&
    device !== null &&
    typeof device.deviceKey === 'string' &&
    (device.label === undefined || typeof device.label === 'string') &&
    Array.isArray(device.spans) &&
    device.spans.every(
      (span: Partial<SessionSpan> | null) =>
        typeof span?.joinedAt === 'string' && typeof span.leftAt === 'string',
    )
  )
}

function sortSpans(spans: SessionSpan[]): SessionSpan[] {
  return [...spans].sort(
    (a, b) => compare(a.joinedAt, b.joinedAt) || compare(a.leftAt, b.leftAt),
  )
}

// Code-unit order, not `localeCompare`, so every platform sorts the same way.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
