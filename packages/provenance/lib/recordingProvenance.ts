/**
 * Decides what a recording's listed statements prove about it. Core fetches
 * the statements and passes them in. This module does no fetching.
 *
 * The document's list of statement addresses can be edited by any peer. Each
 * statement must verify and bind to this recording's audio. Return only fields
 * taken from statements that passed, never from the document.
 */

import {
  checkDeviceCertificate,
  type DeviceCertificateProblem,
} from './deviceCertificate'
import { sha256Hex } from './encoding'
import {
  checkHostReceipt,
  checkRecordingClaim,
  type ClaimProblem,
  type ReceiptProblem,
} from './hostReceipt'
import { parseSignedStatement, statementType } from './recordingClaim'
import { checkSessionRecord, type SessionRecordProblem } from './sessionRecord'
import { statementBytes } from './signing'
import {
  DEVICE_CERTIFICATE_TYPE,
  HOST_RECEIPT_TYPE,
  RECORDING_CLAIM_TYPE,
  SESSION_RECORD_TYPE,
  type DeviceCertificate,
  type HostReceipt,
  type RecordingClaim,
  type SessionRecord,
  type SessionSpan,
  type Signed,
} from './types'

/**
 * One address from a recording's statement list. `bytes` is null when no host
 * could serve it.
 */
export type FetchedStatement = {
  hash: string
  bytes: Uint8Array<ArrayBuffer> | null
}

/** Why a listed statement failed. */
export type StatementProblem =
  /** The bytes do not hash to the address the document lists. */
  | 'address-mismatch'
  /** The bytes are not the statement's canonical JSON. */
  | 'not-canonical'
  /** The receipt names a claim that is not listed or did not pass. */
  | 'claim-not-listed'
  /** The session record is for a session no passing claim belongs to. */
  | 'session-mismatch'
  /** The session record is for the claim's session but does not list it. */
  | 'claim-not-in-session'
  /** The device certificate is not named by any passing claim. */
  | 'certificate-not-claimed'
  /** The device certificate is for a different device key from the claim's. */
  | 'certificate-device-mismatch'
  | ClaimProblem
  | DeviceCertificateProblem
  | ReceiptProblem
  | SessionRecordProblem

/** The fields a passing claim vouches for. Times are the device's clock. */
export type ClaimedRecording = {
  deviceKey: string
  startedAt: string
  endedAt: string
  /** `NO_SESSION_ID` when the recording belongs to no session. */
  sessionId: string
  /** From a passing session record that lists the claim, when one is listed. */
  session?: VerifiedSession
  /** From the passing device certificate the claim names, when it names one. */
  person?: VerifiedPerson
}

/**
 * The fields a passing device certificate vouches for. The person signed the
 * label, so unlike a session label it is the person's own name for the device.
 */
export type VerifiedPerson = {
  personKey: string
  deviceLabel: string
  /** The device's clock. */
  issuedAt: string
}

/**
 * The fields a passing session record vouches for. Times are the host's clock.
 * Device labels are left out: a device names itself, so a label proves nothing.
 */
export type VerifiedSession = {
  openedAt: string
  closedAt: string
  hostKey: string
  devices: { deviceKey: string; spans: SessionSpan[] }[]
}

export type RecordingProvenance =
  /** A claim and at least one receipt for it pass, and nothing failed. */
  | ({
      state: 'verified'
      /** The earliest passing receipt's time, from the host's clock. */
      receivedAt: string
      /**
       * The receipt is signed by the claim's own device key. The host recorded
       * the take itself, so the receipt is not independent confirmation.
       */
      recordedByHost: boolean
    } & ClaimedRecording)
  /** A claim passes and nothing failed, but no receipt names it. */
  | ({ state: 'device-only' } & ClaimedRecording)
  /** No statements are listed, or none of a type this version knows. */
  | { state: 'unverified' }
  /** A listed statement of a known type failed a check. */
  | {
      state: 'failed'
      failures: { hash: string; problem: StatementProblem }[]
    }
  /** Nothing failed, but some listed statements could not be fetched. */
  | { state: 'unavailable'; missing: string[] }

type Checked =
  | { kind: 'claim'; claim: RecordingClaim }
  | { kind: 'receipt'; receipt: HostReceipt }
  | { kind: 'session'; record: SessionRecord }
  | { kind: 'certificate'; certificate: DeviceCertificate }
  | { kind: 'unknown' }
  | { kind: 'failed'; problem: StatementProblem }

async function checkStatement(
  { hash, bytes }: { hash: string; bytes: Uint8Array<ArrayBuffer> },
  blob: { hash: string; size: number },
): Promise<Checked> {
  if ((await sha256Hex(bytes)) !== hash) {
    return { kind: 'failed', problem: 'address-mismatch' }
  }
  const signed = parseSignedStatement(bytes)
  if (!signed) {
    return { kind: 'failed', problem: 'malformed' }
  }
  // Receipts name a claim by the hash of its canonical form. Other bytes for
  // the same statement would sit at an address no receipt can name.
  if (!isCanonical(bytes, signed)) {
    return { kind: 'failed', problem: 'not-canonical' }
  }

  const type = statementType(signed)
  if (type === RECORDING_CLAIM_TYPE) {
    const check = await checkRecordingClaim(signed, blob)
    return check.ok
      ? { kind: 'claim', claim: check.claim.payload }
      : { kind: 'failed', problem: check.problem }
  }
  if (type === HOST_RECEIPT_TYPE) {
    const check = await checkHostReceipt(signed)
    return check.ok
      ? { kind: 'receipt', receipt: check.receipt.payload }
      : { kind: 'failed', problem: check.problem }
  }
  if (type === SESSION_RECORD_TYPE) {
    const check = await checkSessionRecord(signed)
    return check.ok
      ? { kind: 'session', record: check.record.payload }
      : { kind: 'failed', problem: check.problem }
  }
  if (type === DEVICE_CERTIFICATE_TYPE) {
    const check = await checkDeviceCertificate(signed)
    return check.ok
      ? { kind: 'certificate', certificate: check.certificate.payload }
      : { kind: 'failed', problem: check.problem }
  }
  // Later statement types must not break this version.
  return { kind: 'unknown' }
}

function isCanonical(bytes: Uint8Array, signed: Signed<unknown>): boolean {
  let canonical: Uint8Array
  try {
    canonical = statementBytes(signed)
  } catch {
    return false
  }
  return (
    canonical.length === bytes.length &&
    canonical.every((byte, i) => byte === bytes[i])
  )
}

/** Sorts unparseable times last, so they never win "earliest". */
function timeOf(receipt: HostReceipt): number {
  const time = Date.parse(receipt.receivedAt)
  return Number.isNaN(time) ? Infinity : time
}

/**
 * Checks a recording's statements against its audio and returns what they
 * prove. `blob` is the recording's own descriptor from the document. A claim
 * must describe exactly that audio.
 */
export async function verifyRecordingStatements(
  blob: { hash: string; size: number },
  statements: FetchedStatement[],
): Promise<RecordingProvenance> {
  const failures: { hash: string; problem: StatementProblem }[] = []
  const missing: string[] = []
  const claims = new Map<string, RecordingClaim>()
  const receipts: { hash: string; receipt: HostReceipt }[] = []
  const sessions: { hash: string; record: SessionRecord }[] = []
  const certificates = new Map<string, DeviceCertificate>()

  const unique = new Map(statements.map((s) => [s.hash, s.bytes]))
  for (const [hash, bytes] of unique) {
    if (!bytes) {
      missing.push(hash)
      continue
    }
    const checked = await checkStatement({ hash, bytes }, blob)
    if (checked.kind === 'claim') {
      claims.set(hash, checked.claim)
    } else if (checked.kind === 'receipt') {
      receipts.push({ hash, receipt: checked.receipt })
    } else if (checked.kind === 'session') {
      sessions.push({ hash, record: checked.record })
    } else if (checked.kind === 'certificate') {
      certificates.set(hash, checked.certificate)
    } else if (checked.kind === 'failed') {
      failures.push({ hash, problem: checked.problem })
    }
  }

  // A receipt for unlisted audio is tampering, not noise to skip.
  for (const { hash, receipt } of receipts) {
    if (!claims.has(receipt.claim)) {
      failures.push({ hash, problem: 'claim-not-listed' })
    }
  }
  // A session record must cover a passing claim, for the same reason.
  for (const { hash, record } of sessions) {
    const problem = sessionProblem(record, claims)
    if (problem) {
      failures.push({ hash, problem })
    }
  }

  // A certificate must vouch for the key of a passing claim that names it.
  // Listing one for another device would put a person's name on this take.
  const named = new Map<string, RecordingClaim[]>()
  for (const claim of claims.values()) {
    if (claim.deviceCert !== undefined) {
      named.set(claim.deviceCert, [
        ...(named.get(claim.deviceCert) ?? []),
        claim,
      ])
    }
  }
  for (const [hash, certificate] of certificates) {
    const namedBy = named.get(hash)
    if (!namedBy) {
      failures.push({ hash, problem: 'certificate-not-claimed' })
    } else if (namedBy.some((c) => c.deviceKey !== certificate.deviceKey)) {
      failures.push({ hash, problem: 'certificate-device-mismatch' })
    }
  }
  // A claim's certificate that is not listed cannot be checked. Showing the
  // claim without it would hide that the device named a person.
  for (const address of named.keys()) {
    if (!unique.has(address)) {
      missing.push(address)
    }
  }

  if (failures.length > 0) {
    return { state: 'failed', failures }
  }
  if (missing.length > 0) {
    return { state: 'unavailable', missing }
  }

  // Every session record now covers a passing claim. A recording belongs to
  // one session, so the first listed is the one to show.
  const session = sessions[0]?.record
  const claimed = (claim: RecordingClaim) => {
    const certificate =
      claim.deviceCert !== undefined
        ? certificates.get(claim.deviceCert)
        : undefined
    return {
      ...claimedRecording(claim),
      ...(session && { session: verifiedSession(session) }),
      ...(certificate && { person: verifiedPerson(certificate) }),
    }
  }

  // Every receipt now names a passing claim. Several receipts for one claim
  // can come from a retried upload, so show the earliest arrival.
  const earliest = receipts
    .map(({ receipt }) => receipt)
    .sort((a, b) => timeOf(a) - timeOf(b))[0]
  if (earliest) {
    const claim = claims.get(earliest.claim)!
    return {
      state: 'verified',
      ...claimed(claim),
      receivedAt: earliest.receivedAt,
      recordedByHost: earliest.hostKey === claim.deviceKey,
    }
  }
  // All passing claims describe this recording's audio, so any one will do.
  const [claim] = claims.values()
  if (claim) {
    return { state: 'device-only', ...claimed(claim) }
  }
  return { state: 'unverified' }
}

function claimedRecording(claim: RecordingClaim): ClaimedRecording {
  return {
    deviceKey: claim.deviceKey,
    startedAt: claim.startedAt,
    endedAt: claim.endedAt,
    sessionId: claim.sessionId,
  }
}

function sessionProblem(
  record: SessionRecord,
  claims: Map<string, RecordingClaim>,
): StatementProblem | undefined {
  const inSession = [...claims].filter(
    ([, claim]) => claim.sessionId === record.sessionId,
  )
  if (inSession.length === 0) {
    return 'session-mismatch'
  }
  if (!inSession.some(([address]) => record.claims.includes(address))) {
    return 'claim-not-in-session'
  }
  return undefined
}

function verifiedSession(record: SessionRecord): VerifiedSession {
  return {
    openedAt: record.openedAt,
    closedAt: record.closedAt,
    hostKey: record.hostKey,
    devices: record.devices.map(({ deviceKey, spans }) => ({
      deviceKey,
      spans,
    })),
  }
}

function verifiedPerson(certificate: DeviceCertificate): VerifiedPerson {
  return {
    personKey: certificate.personKey,
    deviceLabel: certificate.deviceLabel,
    issuedAt: certificate.issuedAt,
  }
}
