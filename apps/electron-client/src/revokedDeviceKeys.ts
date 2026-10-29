import type { PersonRoster } from './personRoster'

/**
 * Whether this host knows a device key to be revoked, asked on every sync
 * upgrade that proved one.
 *
 * The roster is the only record that answers by device key. It holds every
 * vouch this host signed and the revocation once its operator withdrew one.
 * A person's own revocation of a certificate lives in the blob store under
 * its own hash, and asking that by device key needs an index that does not
 * exist. A host that has only seen one of those still lets the device in:
 * not knowing is not grounds to refuse.
 *
 * Do not import `electron` here. The sync server uses this module, and it
 * stays testable in a plain node process.
 */
export async function isRevokedDeviceKey(
  roster: PersonRoster,
  deviceKey: string,
): Promise<boolean> {
  const people = await roster.list()
  return people.some((person) =>
    (person.vouches ?? []).some(
      (vouch) => vouch.deviceKey === deviceKey && vouch.revokedAt !== undefined,
    ),
  )
}
