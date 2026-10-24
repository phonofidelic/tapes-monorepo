import {
  backupToFileText,
  backupToText,
  createJoinRequest,
  encodeSignedStatement,
  parseBackupText,
  unwrapPersonKey,
  wrapPersonKey,
} from '@tapes-monorepo/provenance'
import { loadDeviceSigningKey } from './deviceSigningKey'
import { deriveArgon2id } from './passphrase'
import {
  createPersonIdentity,
  loadPersonIdentity,
  markPersonKeyBackedUp,
  markPersonKeyJoined,
  type PersonIdentity,
} from './personKey'

/**
 * What the worker answers to core's person key requests. The private key never
 * leaves the worker. Only public keys, the encoded certificate and the backup
 * text cross to the page.
 */

/** Mirrors core's `PersonKeyStatus`. */
export type PersonKeyStatus =
  | { exists: false }
  | {
      exists: true
      publicKey: string
      /** The encoded signed certificate for this device. */
      certificate: string
      certificateAddress: string
      backedUpAt?: string
      joinedAt?: string
    }

function statusOf(identity: PersonIdentity | undefined): PersonKeyStatus {
  if (!identity) {
    return { exists: false }
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

export async function personKeyStatus(): Promise<PersonKeyStatus> {
  return statusOf(await loadPersonIdentity())
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
