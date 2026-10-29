import {
  decodeSignedStatement,
  type RevocationReason,
} from '@tapes-monorepo/provenance'
import type { AppContextValue } from '@/context/AppContext'
import { callWorker } from '@/workerClient'

/**
 * The person key on this device, as the page sees it. Only web guests have
 * one: the worker creates it on first join and never hands out its private
 * key. The desktop host has no person key, so it reports none. A guest that
 * lost its keys and re-joined reports the person the host vouched for.
 */

export type PersonKeyStatus =
  | { exists: false }
  | {
      exists: true
      publicKey: string
      /**
       * The encoded signed certificate for this device, or the host's vouch
       * when it re-joined without its person key.
       */
      certificate: string
      certificateAddress: string
      /** When a saved backup last unlocked with its passphrase. */
      backedUpAt?: string
      /** When a passkey record was last written or opened on this device. */
      passkeyRecordedAt?: string
      /** When this guest's host added the person to its roster. */
      joinedAt?: string
      /**
       * The name of the host that vouched for this device. Set only when the
       * device has no person key, so there is nothing here to back up.
       */
      vouchedBy?: string
    }

export type BackupCheck =
  | { ok: true; backedUpAt: string }
  | {
      ok: false
      problem: 'unreadable' | 'wrong-passphrase' | 'other-person-key'
    }

const NONE: PersonKeyStatus = { exists: false }

export async function readPersonKeyStatus(
  appContext: AppContextValue,
): Promise<PersonKeyStatus> {
  if (appContext.type !== 'web-client') {
    return NONE
  }
  return callWorker<PersonKeyStatus>(appContext.worker, 'person:status')
}

/** Makes the person key and this device's certificate, unless both exist. */
export async function createPersonKey(
  appContext: AppContextValue,
  deviceLabel: string,
): Promise<PersonKeyStatus> {
  if (appContext.type !== 'web-client') {
    return NONE
  }
  return callWorker<PersonKeyStatus>(appContext.worker, 'person:create', {
    deviceLabel,
  })
}

export async function generatePassphrase(worker: Worker): Promise<string> {
  const { passphrase } = await callWorker<{ passphrase: string }>(
    worker,
    'person:passphrase',
  )
  return passphrase
}

/**
 * Locks the person key with the passphrase. `text` goes in the QR code and
 * `fileText` in the saved file. Takes about a second on a phone.
 */
export function backUpPersonKey(
  worker: Worker,
  passphrase: string,
): Promise<{ text: string; fileText: string }> {
  return callWorker(worker, 'person:backup', { passphrase })
}

/** Unlocks a saved backup again. On success the key counts as backed up. */
export function checkPersonKeyBackup(
  worker: Worker,
  text: string,
  passphrase: string,
): Promise<BackupCheck> {
  return callWorker(worker, 'person:check-backup', { text, passphrase })
}

/**
 * The encoded certificate a claim names, to send with its upload. Undefined
 * when the claim names none or this device holds a different one.
 */
export async function certificateForClaim(
  appContext: AppContextValue,
  claim: string | undefined,
): Promise<string | undefined> {
  const payload = claim && decodeSignedStatement(claim)?.payload
  const named = (payload as { deviceCert?: unknown } | undefined)?.deviceCert
  if (typeof named !== 'string') {
    return undefined
  }
  try {
    const status = await readPersonKeyStatus(appContext)
    return status.exists && status.certificateAddress === named
      ? status.certificate
      : undefined
  } catch (error) {
    console.warn('Uploading without the device certificate:', error)
    return undefined
  }
}

export type RestoreResult =
  | { ok: true; status: PersonKeyStatus }
  | {
      ok: false
      problem:
        'unreadable' | 'wrong-passphrase' | 'wrong-passkey' | 'other-person-key'
    }

/**
 * Restores the person key from its backup on this device. On success the
 * person key has certified this device in place of any host vouch. Takes
 * about a second on a phone, like a backup check.
 */
export function restorePersonKey(
  worker: Worker,
  text: string,
  passphrase: string,
  deviceLabel: string,
): Promise<RestoreResult> {
  return callWorker(worker, 'person:restore', { text, passphrase, deviceLabel })
}

/**
 * Restores the person key from a record the host held, unlocked by the same
 * passkey. Quick next to a passphrase restore: there is no Argon2id to run.
 */
export function restorePersonKeyWithPasskey(
  worker: Worker,
  record: string,
  prf: Uint8Array<ArrayBuffer>,
  deviceLabel: string,
): Promise<RestoreResult> {
  return callWorker(worker, 'person:passkey-restore', {
    record,
    prf,
    deviceLabel,
  })
}

/**
 * Signs a statement that one of this person's devices should no longer be
 * trusted. Only a device holding the person key can do this, so it rejects
 * elsewhere rather than returning nothing.
 */
export async function signDeviceRevocation(
  appContext: AppContextValue,
  device: { deviceKey: string; deviceLink: string; reason: RevocationReason },
): Promise<string> {
  if (appContext.type !== 'web-client') {
    throw new Error('Only a guest with a person key can revoke a device')
  }
  const { revocation } = await callWorker<{ revocation: string }>(
    appContext.worker,
    'person:revoke-device',
    device,
  )
  return revocation
}

/** Notes that the host already has the restored person on its roster. */
export function markPersonKeyJoined(
  worker: Worker,
): Promise<{ joinedAt: string }> {
  return callWorker(worker, 'person:mark-joined')
}
