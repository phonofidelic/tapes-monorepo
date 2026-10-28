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
import {
  checkDeviceRevocation,
  revocationCovers,
  type RevocationProblem,
} from './deviceRevocation'
import { checkDeviceVouch, type VouchProblem } from './deviceVouch'
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
  DEVICE_REVOCATION_TYPE,
  DEVICE_VOUCH_TYPE,
  HOST_RECEIPT_TYPE,
  RECORDING_CLAIM_TYPE,
  SESSION_RECORD_TYPE,
  type DeviceCertificate,
  type DeviceRevocation,
  type DeviceVouch,
  type HostReceipt,
  type RecordingClaim,
  type SessionRecord,
  type SessionSpan,
  type RevocationReason,
  type RevocationSigner,
  type Signed,
  type VouchMethod,
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
  /** The device certificate or vouch is not named by any passing claim. */
  | 'certificate-not-claimed'
  /** The certificate or vouch is for a different device key from the claim's. */
  | 'certificate-device-mismatch'
  /** The revocation names no certificate or vouch that passed. */
  | 'revocation-not-claimed'
  /** The signer of the revocation could not withdraw that statement. */
  | 'revocation-not-permitted'
  | ClaimProblem
  | DeviceCertificateProblem
  | VouchProblem
  | RevocationProblem
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
  /** From the passing certificate or vouch the claim names, if it names one. */
  person?: VerifiedPerson
  /**
   * Address of that certificate or vouch. A reader who wants to withdraw it
   * signs a revocation naming this.
   */
  deviceLink?: string
  /** Set when a passing revocation withdraws that certificate or vouch. */
  revocation?: RevokedDeviceLink
}

/**
 * A passing revocation of the certificate or vouch a claim names. The
 * recording still has whatever signatures it had. What changed is that the
 * signer no longer stands behind the device key.
 */
export type RevokedDeviceLink = {
  /** Whether the person key or the vouching host withdrew its trust. */
  signedBy: RevocationSigner
  /** The signer's base64url Ed25519 public key. */
  signerKey: string
  reason: RevocationReason
  /** The signer's clock. */
  revokedAt: string
  /**
   * Whether a host had this recording before trust in the device ended. A lost
   * device's own clock says nothing here, so this is true only when a passing
   * receipt is earlier than the revocation.
   */
  receivedBeforeRevocation: boolean
}

/** Who a passing device certificate or vouch ties the device to. */
export type VerifiedPerson =
  /**
   * The person key certified the device. The person signed the label, so
   * unlike a session label it is the person's own name for the device.
   */
  | {
      via: 'certificate'
      personKey: string
      deviceLabel: string
      /** The device's clock. */
      issuedAt: string
    }
  /**
   * A host saw the person take up the device. The person key signed nothing,
   * so this is only as good as the host. Whether to trust the host is the
   * reader's decision. The names and labels are the host's, unverified.
   */
  | {
      via: 'vouch'
      personKey: string
      personName: string
      deviceLabel: string
      hostKey: string
      hostLabel: string
      method: VouchMethod
      /** The host's clock. */
      vouchedAt: string
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
  | { kind: 'link'; link: DeviceCertificate | DeviceVouch }
  | { kind: 'revocation'; revocation: DeviceRevocation }
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
      ? { kind: 'link', link: check.certificate.payload }
      : { kind: 'failed', problem: check.problem }
  }
  if (type === DEVICE_VOUCH_TYPE) {
    const check = await checkDeviceVouch(signed)
    return check.ok
      ? { kind: 'link', link: check.vouch.payload }
      : { kind: 'failed', problem: check.problem }
  }
  if (type === DEVICE_REVOCATION_TYPE) {
    const check = await checkDeviceRevocation(signed)
    return check.ok
      ? { kind: 'revocation', revocation: check.revocation.payload }
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
function timeOf(iso: string): number {
  const time = Date.parse(iso)
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
  // Device certificates and vouches, which tie a claim's device to a person.
  const links = new Map<string, DeviceCertificate | DeviceVouch>()
  const revocations = new Map<string, DeviceRevocation>()

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
    } else if (checked.kind === 'link') {
      links.set(hash, checked.link)
    } else if (checked.kind === 'revocation') {
      revocations.set(hash, checked.revocation)
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

  // A certificate or vouch must be for the key of a passing claim that names
  // it. Listing one for another device would put a person's name on this take.
  const named = new Map<string, RecordingClaim[]>()
  for (const claim of claims.values()) {
    if (claim.deviceCert !== undefined) {
      named.set(claim.deviceCert, [
        ...(named.get(claim.deviceCert) ?? []),
        claim,
      ])
    }
  }
  for (const [hash, link] of links) {
    const namedBy = named.get(hash)
    if (!namedBy) {
      failures.push({ hash, problem: 'certificate-not-claimed' })
    } else if (namedBy.some((c) => c.deviceKey !== link.deviceKey)) {
      failures.push({ hash, problem: 'certificate-device-mismatch' })
    }
  }
  // A revocation has to withdraw a certificate or vouch that passed here, and
  // its signer has to have been able to withdraw that one. Otherwise any peer
  // could cast doubt on a recording by listing a statement about its device.
  for (const [hash, revocation] of revocations) {
    const link = links.get(revocation.deviceLink)
    if (!link) {
      failures.push({ hash, problem: 'revocation-not-claimed' })
    } else if (!revocationCovers(revocation, link, revocation.deviceLink)) {
      failures.push({ hash, problem: 'revocation-not-permitted' })
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
  // Every receipt now names a passing claim. Several receipts for one claim
  // can come from a retried upload, so show the earliest arrival.
  const earliest = receipts
    .map(({ receipt }) => receipt)
    .sort((a, b) => timeOf(a.receivedAt) - timeOf(b.receivedAt))[0]

  const claimed = (claim: RecordingClaim) => {
    const address = claim.deviceCert
    const link = address !== undefined ? links.get(address) : undefined
    const revocation =
      link && address !== undefined
        ? firstRevocation(address, link, revocations)
        : undefined
    return {
      ...claimedRecording(claim),
      ...(session && { session: verifiedSession(session) }),
      ...(link && { person: verifiedPerson(link), deviceLink: address }),
      ...(revocation && {
        revocation: revokedDeviceLink(revocation, earliest?.receivedAt),
      }),
    }
  }

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

/**
 * The first revocation of this certificate or vouch. Trust ended when that one
 * was signed, whatever came after it.
 */
function firstRevocation(
  linkAddress: string,
  link: DeviceCertificate | DeviceVouch,
  revocations: Map<string, DeviceRevocation>,
): DeviceRevocation | undefined {
  return [...revocations.values()]
    .filter((revocation) => revocationCovers(revocation, link, linkAddress))
    .sort((a, b) => timeOf(a.revokedAt) - timeOf(b.revokedAt))[0]
}

function revokedDeviceLink(
  revocation: DeviceRevocation,
  receivedAt: string | undefined,
): RevokedDeviceLink {
  const received = receivedAt === undefined ? NaN : Date.parse(receivedAt)
  const revoked = Date.parse(revocation.revokedAt)
  return {
    signedBy: revocation.signedBy,
    signerKey: revocation.signerKey,
    reason: revocation.reason,
    revokedAt: revocation.revokedAt,
    // A time that will not parse leaves the recording on the doubtful side.
    receivedBeforeRevocation:
      Number.isFinite(received) && Number.isFinite(revoked)
        ? received < revoked
        : false,
  }
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

function verifiedPerson(link: DeviceCertificate | DeviceVouch): VerifiedPerson {
  if (link.type === DEVICE_VOUCH_TYPE) {
    return {
      via: 'vouch',
      personKey: link.personKey,
      personName: link.personName,
      deviceLabel: link.deviceLabel,
      hostKey: link.hostKey,
      hostLabel: link.hostLabel,
      method: link.method,
      vouchedAt: link.vouchedAt,
    }
  }
  return {
    via: 'certificate',
    personKey: link.personKey,
    deviceLabel: link.deviceLabel,
    issuedAt: link.issuedAt,
  }
}
