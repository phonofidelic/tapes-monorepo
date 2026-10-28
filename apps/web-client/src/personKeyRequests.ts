import {
  backupToFileText,
  backupToText,
  createJoinRequest,
  createVouchRequest,
  decodeSignedStatement,
  encodeSignedStatement,
  exportPublicKey,
  parseBackupText,
  unwrapPersonKey,
  wrapPersonKey,
} from '@tapes-monorepo/provenance'
import { loadDeviceSigningKey } from './deviceSigningKey'
import {
  clearDeviceVouch,
  loadDeviceVouch,
  storeDeviceVouch,
  type StoredVouch,
  type VouchRejection,
} from './deviceVouch'
import { deriveArgon2id } from './passphrase'
import {
  createPersonIdentity,
  loadPersonIdentity,
  markPersonKeyBackedUp,
  markPersonKeyJoined,
  restorePersonIdentity,
  type PersonIdentity,
} from './personKey'

/**
 * What the worker answers to core's person key requests. The private key never
 * leaves the worker. Only public keys, the encoded certificate or vouch and
 * the backup text cross to the page.
 *
 * A guest with a person key reports its certificate. A guest that re-joined
 * without one reports the host's vouch in the same fields, since claims name
 * either one the same way.
 */

/** Mirrors core's `PersonKeyStatus`. */
export type PersonKeyStatus =
  | { exists: false }
  | {
      exists: true
      publicKey: string
      /** The encoded signed certificate or vouch for this device. */
      certificate: string
      certificateAddress: string
      backedUpAt?: string
      joinedAt?: string
      /** The name of the host that vouched, when this device has no person key. */
      vouchedBy?: string
    }

function statusOf(
  identity: PersonIdentity | undefined,
  vouch?: StoredVouch,
): PersonKeyStatus {
  if (!identity) {
    return vouch ? vouchStatus(vouch) : { exists: false }
  }
  return {
    exists: true,
    publicKey: identity.publicKey,
    certificate: encodeSignedStatement(identity.certificate),
    certificateAddress: identity.certificateAddress,
    backedUpAt: identity.backedUpAt,
    joinedAt: identity.joinedAt,
  }
}

function vouchStatus({ vouch, address }: StoredVouch): PersonKeyStatus {
  return {
    exists: true,
    publicKey: vouch.payload.personKey,
    certificate: encodeSignedStatement(vouch),
    certificateAddress: address,
    // The host vouched for a person on its roster.
    joinedAt: vouch.payload.vouchedAt,
    vouchedBy: vouch.payload.hostLabel,
  }
}

export async function personKeyStatus(): Promise<PersonKeyStatus> {
  const identity = await loadPersonIdentity()
  return statusOf(identity, identity ? undefined : await loadDeviceVouch())
}

/**
 * The address claims should name for this device: its certificate, or the
 * host's vouch when it has no person key. Undefined when it has neither.
 */
export async function deviceLinkAddress(): Promise<string | undefined> {
  const identity = await loadPersonIdentity()
  return identity?.certificateAddress ?? (await loadDeviceVouch())?.address
}

/** Signs a request for the host to vouch for this device as `personKey`. */
export async function signVouchRequest(
  personKey: string,
  deviceLabel: string,
): Promise<{ request: string }> {
  const request = await createVouchRequest(
    { personKey, deviceLabel },
    await loadDeviceSigningKey(),
  )
  return { request: encodeSignedStatement(request) }
}

export type VouchAcceptance =
  { ok: true; status: PersonKeyStatus } | { ok: false; problem: VouchRejection }

/**
 * Stores the host's vouch for this device, if the pinned host signed it for
 * this device's key.
 */
export async function acceptVouch(
  encoded: string,
  pinnedHostKey: string | undefined,
): Promise<VouchAcceptance> {
  const signed = decodeSignedStatement(encoded)
  if (!signed) {
    return { ok: false, problem: 'bad-vouch' }
  }
  const deviceKey = await exportPublicKey(
    (await loadDeviceSigningKey()).publicKey,
  )
  const result = await storeDeviceVouch(signed, {
    hostKey: pinnedHostKey,
    deviceKey,
  })
  return result.ok
    ? { ok: true, status: vouchStatus(result.stored) }
    : { ok: false, problem: result.problem }
}

export async function createPersonKey(
  deviceLabel: string,
): Promise<PersonKeyStatus> {
  const keyPair = await loadDeviceSigningKey()
  return statusOf(await createPersonIdentity({ keyPair, label: deviceLabel }))
}

/** Locks the stored person key with the passphrase. Does not mark it saved. */
export async function backUpPersonKey(
  passphrase: string,
): Promise<{ text: string; fileText: string }> {
  const identity = await loadPersonIdentity()
  if (!identity) {
    throw new Error('There is no person key to back up')
  }
  const backup = await wrapPersonKey(
    identity.keyPair,
    passphrase,
    deriveArgon2id,
  )
  return { text: backupToText(backup), fileText: backupToFileText(backup) }
}

export type BackupCheck =
  | { ok: true; backedUpAt: string }
  | {
      ok: false
      problem: 'unreadable' | 'wrong-passphrase' | 'other-person-key'
    }

/**
 * Unlocks a backup with the passphrase the person typed again. When it opens
 * to the stored person key, the key is marked as backed up.
 */
export async function checkPersonKeyBackup(
  text: string,
  passphrase: string,
): Promise<BackupCheck> {
  const parsed = parseBackupText(text)
  if (!parsed.ok) {
    return { ok: false, problem: 'unreadable' }
  }
  const unwrapped = await unwrapPersonKey(
    parsed.backup,
    passphrase,
    deriveArgon2id,
  )
  if (!unwrapped.ok) {
    return { ok: false, problem: 'wrong-passphrase' }
  }
  const identity = await loadPersonIdentity()
  if (identity?.publicKey !== unwrapped.publicKey) {
    return { ok: false, problem: 'other-person-key' }
  }
  const at = new Date()
  await markPersonKeyBackedUp(unwrapped.publicKey, at)
  return { ok: true, backedUpAt: at.toISOString() }
}

/**
 * Signs a request to join the host's roster over the host's challenge. The
 * page sends it, with the PIN, which never reaches this worker.
 */
export async function signJoinRequest(
  challenge: string,
  personName: string,
): Promise<{ join: string; certificate: string }> {
  const identity = await loadPersonIdentity()
  if (!identity) {
    throw new Error('There is no person key to join with')
  }
  const join = await createJoinRequest(
    {
      personName,
      certificate: identity.certificateAddress,
      challenge,
    },
    identity.keyPair,
  )
  return {
    join: encodeSignedStatement(join),
    certificate: encodeSignedStatement(identity.certificate),
  }
}

/** Notes the host's answer to a join. Returns when, for the page's status. */
export async function markJoined(): Promise<{ joinedAt: string }> {
  const identity = await loadPersonIdentity()
  if (!identity) {
    throw new Error('There is no person key that joined')
  }
  const at = new Date()
  await markPersonKeyJoined(identity.publicKey, at)
  return { joinedAt: at.toISOString() }
}

export type RestoreResult =
  | { ok: true; status: PersonKeyStatus }
  | {
      ok: false
      problem: 'unreadable' | 'wrong-passphrase' | 'other-person-key'
    }

/**
 * Restores the person key from its backup on this device. The person key then
 * signs a certificate for this device's key, which replaces the host's vouch.
 * Recordings made under either still name the same person key.
 */
export async function restorePersonKey(
  text: string,
  passphrase: string,
  deviceLabel: string,
): Promise<RestoreResult> {
  const parsed = parseBackupText(text)
  if (!parsed.ok) {
    return { ok: false, problem: 'unreadable' }
  }
  const unwrapped = await unwrapPersonKey(
    parsed.backup,
    passphrase,
    deriveArgon2id,
  )
  if (!unwrapped.ok) {
    return { ok: false, problem: 'wrong-passphrase' }
  }
  const vouch = await loadDeviceVouch()
  // A vouch for another person is not this person's to replace.
  if (vouch && vouch.vouch.payload.personKey !== unwrapped.publicKey) {
    return { ok: false, problem: 'other-person-key' }
  }
  const result = await restorePersonIdentity(
    { keyPair: await loadDeviceSigningKey(), label: deviceLabel },
    {
      keyPair: unwrapped.keyPair,
      backedUpAt: new Date(),
      // The host vouched for a person on its roster, so they have joined.
      joinedAt: vouch?.vouch.payload.vouchedAt,
    },
  )
  if (!result.ok) {
    return result
  }
  await clearDeviceVouch()
  return { ok: true, status: statusOf(result.identity) }
}
