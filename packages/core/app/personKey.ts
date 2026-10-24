import { decodeSignedStatement } from '@tapes-monorepo/provenance'
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
