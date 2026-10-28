/**
 * The statement that withdraws trust in a device key, and the rule for who may
 * sign it. A person key revokes a certificate it signed, or a vouch made in
 * its name. A host revokes only a vouch it signed itself.
 *
 * A revocation never cancels a recording. It says when trust ended, so a
 * reader can tell a take the host received earlier from one it received after.
 * The lost device's own clock is no use for that line.
 */

import { exportPublicKey, signStatement, verifyStatement } from './signing'
import {
  DEVICE_REVOCATION_TYPE,
  DEVICE_VOUCH_TYPE,
  type DeviceRevocation,
  type RevocationReason,
  type RevocationSigner,
  type Signed,
} from './types'
import type { DeviceLink } from './deviceVouch'

export async function createDeviceRevocation(
  details: {
    signedBy: RevocationSigner
    deviceKey: string
    /** Address of the certificate or vouch being withdrawn. */
    deviceLink: string
    reason: RevocationReason
    revokedAt?: Date
  },
  keyPair: CryptoKeyPair,
): Promise<Signed<DeviceRevocation>> {
  return signStatement(
    {
      type: DEVICE_REVOCATION_TYPE,
      signerKey: await exportPublicKey(keyPair.publicKey),
      signedBy: details.signedBy,
      deviceKey: details.deviceKey,
      deviceLink: details.deviceLink,
      reason: details.reason,
      revokedAt: (details.revokedAt ?? new Date()).toISOString(),
    },
    keyPair.privateKey,
  )
}

/** Why a revocation did not verify. */
export type RevocationProblem = 'malformed' | 'bad-signature'

export type DeviceRevocationCheck =
  | { ok: true; revocation: Signed<DeviceRevocation> }
  | { ok: false; problem: RevocationProblem }

/**
 * Checks a revocation's shape and that the key it names signed it. That key
 * may be anyone's, so the caller must still call `revocationCovers` with the
 * statement being withdrawn.
 */
export async function checkDeviceRevocation(
  signed: Signed<unknown>,
): Promise<DeviceRevocationCheck> {
  const { payload } = signed
  if (!isDeviceRevocation(payload)) {
    return { ok: false, problem: 'malformed' }
  }
  if (!(await verifyStatement(signed, payload.signerKey))) {
    return { ok: false, problem: 'bad-signature' }
  }
  return { ok: true, revocation: { payload, signature: signed.signature } }
}

/**
 * Whether this revocation withdraws that certificate or vouch. The signer has
 * to have the standing to withdraw it, which is the whole check: anyone can
 * make a key and sign a statement about someone else's device.
 *
 * A person key revokes what names it, certificate or vouch alike. A host
 * revokes a vouch it signed. A host cannot touch a certificate, because the
 * person key behind it never gave the host that power.
 */
export function revocationCovers(
  revocation: DeviceRevocation,
  link: DeviceLink,
  linkAddress: string,
): boolean {
  if (
    revocation.deviceLink !== linkAddress ||
    revocation.deviceKey !== link.deviceKey
  ) {
    return false
  }
  if (revocation.signedBy === 'person') {
    return revocation.signerKey === link.personKey
  }
  return (
    link.type === DEVICE_VOUCH_TYPE && revocation.signerKey === link.hostKey
  )
}

const isString = (value: unknown) => typeof value === 'string'

function isDeviceRevocation(payload: unknown): payload is DeviceRevocation {
  const revocation = payload as Partial<DeviceRevocation> | null
  return (
    typeof revocation === 'object' &&
    revocation !== null &&
    revocation.type === DEVICE_REVOCATION_TYPE &&
    isString(revocation.signerKey) &&
    (revocation.signedBy === 'person' || revocation.signedBy === 'host') &&
    isString(revocation.deviceKey) &&
    isString(revocation.deviceLink) &&
    isRevocationReason(revocation.reason) &&
    isString(revocation.revokedAt)
  )
}

function isRevocationReason(value: unknown): value is RevocationReason {
  return value === 'lost' || value === 'retired' || value === 'wrong-person'
}
