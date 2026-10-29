import path from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createPersonRoster,
  type PersonRoster,
  type RosterEntry,
  type SignedVouch,
} from './personRoster'
import { isRevokedDeviceKey } from './revokedDeviceKeys'

const PHONE_KEY = 'phone-device-key'
const TABLET_KEY = 'tablet-device-key'

let dir: string
let roster: PersonRoster

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tapes-roster-'))
  roster = createPersonRoster(path.join(dir, 'people.json'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function vouch(overrides: Partial<SignedVouch>): SignedVouch {
  return {
    address: 'aa'.repeat(32),
    deviceKey: PHONE_KEY,
    deviceLabel: 'Phone',
    deviceFingerprint: 'ab cd',
    method: 'operator',
    vouchedAt: '2026-10-28T10:00:00.000Z',
    ...overrides,
  }
}

function person(vouches: SignedVouch[]): RosterEntry {
  return {
    personKey: 'person-key',
    name: 'Ada',
    firstCertificate: {
      address: 'cc'.repeat(32),
      signed: {
        payload: {},
        signature: 'x',
      } as RosterEntry['firstCertificate']['signed'],
    },
    vouches,
    joinedAt: '2026-10-28T09:00:00.000Z',
  }
}

describe('isRevokedDeviceKey', () => {
  it('says a key the host withdrew its vouch for is revoked', async () => {
    await roster.put(person([vouch({ revokedAt: '2026-10-29T10:00:00.000Z' })]))

    expect(await isRevokedDeviceKey(roster, PHONE_KEY)).toBe(true)
  })

  it('says a key with a standing vouch is not', async () => {
    await roster.put(person([vouch({})]))

    expect(await isRevokedDeviceKey(roster, PHONE_KEY)).toBe(false)
  })

  // A person can hold two devices, and revoking one says nothing about the
  // other.
  it('leaves the same person’s other device alone', async () => {
    await roster.put(
      person([
        vouch({ revokedAt: '2026-10-29T10:00:00.000Z' }),
        vouch({ address: 'bb'.repeat(32), deviceKey: TABLET_KEY }),
      ]),
    )

    expect(await isRevokedDeviceKey(roster, PHONE_KEY)).toBe(true)
    expect(await isRevokedDeviceKey(roster, TABLET_KEY)).toBe(false)
  })

  // The host never vouched for this key, so it knows nothing about it.
  it('says a key the roster has never seen is not revoked', async () => {
    await roster.put(person([vouch({})]))

    expect(await isRevokedDeviceKey(roster, 'stranger')).toBe(false)
  })

  it('says nothing is revoked on an empty roster', async () => {
    expect(await isRevokedDeviceKey(roster, PHONE_KEY)).toBe(false)
  })
})
