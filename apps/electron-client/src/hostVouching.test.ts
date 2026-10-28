import path from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkDeviceRevocation,
  checkDeviceVouch,
  createDeviceCertificate,
  createJoinRequest,
  createVouchRequest,
  exportPublicKey,
  generateSigningKeyPair,
  parseSignedStatement,
  statementAddress,
} from '@tapes-monorepo/provenance'
import {
  createHostVouching,
  MAX_PENDING,
  MAX_PIN_FAILURES,
  PENDING_TTL_MS,
  type RevocationDelivery,
} from './hostVouching'
import { createPersonRoster, type PersonRoster } from './personRoster'

let dir: string
let roster: PersonRoster
let clock: number
let issued: Set<string>
let changes: number
let delivered: Parameters<RevocationDelivery>[0][]
/** What the delivery reports back, as recording urls. */
let listedOn: string[]

const hostKeys = await generateSigningKeyPair()
const hostKey = await exportPublicKey(hostKeys.publicKey)

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tapes-roster-'))
  roster = createPersonRoster(path.join(dir, 'people.json'))
  clock = Date.parse('2026-10-19T18:00:00.000Z')
  issued = new Set()
  changes = 0
  delivered = []
  listedOn = ['automerge:recording']
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const challenge = () => {
  const value = `challenge-${issued.size}`
  issued.add(value)
  return value
}

const vouching = () =>
  createHostVouching({
    roster,
    loadSigningKey: async () => hostKeys,
    hostLabel: () => 'Studio Mac',
    consumeChallenge: (value) => issued.delete(value),
    deliverRevocation: async (details) => {
      delivered.push(details)
      return listedOn
    },
    now: () => clock,
    onChange: () => {
      changes++
    },
  })

/** A person and the certificate their first device was given. */
async function person() {
  const keys = await generateSigningKeyPair()
  const certificate = await createDeviceCertificate(
    {
      deviceKey: await exportPublicKey(
        (await generateSigningKeyPair()).publicKey,
      ),
      deviceLabel: 'Old phone',
    },
    keys,
  )
  return {
    keys,
    certificate,
    personKey: await exportPublicKey(keys.publicKey),
  }
}

async function join(
  host: ReturnType<typeof vouching>,
  someone: Awaited<ReturnType<typeof person>>,
  name: string,
  pin?: string | null,
) {
  const request = await createJoinRequest(
    {
      personName: name,
      certificate: await statementAddress(someone.certificate),
      challenge: challenge(),
    },
    someone.keys,
  )
  return host.join(request, someone.certificate, pin)
}

const newDevice = async (personKey: string) =>
  createVouchRequest(
    { personKey, deviceLabel: 'New phone' },
    await generateSigningKeyPair(),
  )

async function requestId(host: ReturnType<typeof vouching>, personKey: string) {
  const result = await host.request(await newDevice(personKey))
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.id
}

describe('joining the roster', () => {
  it('lists a person who joined, without their PIN hash', async () => {
    const host = vouching()
    const sam = await person()

    expect(await join(host, sam, ' Sam ', '4821')).toEqual({ ok: true })
    expect(await host.roster()).toEqual([
      { personKey: sam.personKey, name: 'Sam', hasPin: true, pinLocked: false },
    ])
  })

  it('keeps the roster across a restart', async () => {
    const sam = await person()
    await join(vouching(), sam, 'Sam')

    roster = createPersonRoster(path.join(dir, 'people.json'))

    expect(await vouching().roster()).toMatchObject([{ name: 'Sam' }])
  })

  it('renames a person who joins again, and keeps their PIN', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam', '4821')

    await join(host, sam, 'Samantha')

    expect(await host.roster()).toEqual([
      expect.objectContaining({ name: 'Samantha', hasPin: true }),
    ])
    const id = await requestId(host, sam.personKey)
    expect((await host.enterPin(id, '4821')).ok).toBe(true)
  })

  it('refuses a join request whose challenge was already used', async () => {
    const host = vouching()
    const sam = await person()
    const request = await createJoinRequest(
      {
        personName: 'Sam',
        certificate: await statementAddress(sam.certificate),
        challenge: challenge(),
      },
      sam.keys,
    )
    await host.join(request, sam.certificate, undefined)

    expect(await host.join(request, sam.certificate, undefined)).toEqual({
      ok: false,
      error: 'stale-challenge',
    })
  })

  // Anyone paired can read a certificate from the blob store. Without the
  // person key it must not get them onto the roster under a new name.
  it("refuses someone else's certificate", async () => {
    const host = vouching()
    const sam = await person()
    const mallory = await person()
    const request = await createJoinRequest(
      {
        personName: 'Sam',
        certificate: await statementAddress(sam.certificate),
        challenge: challenge(),
      },
      mallory.keys,
    )

    expect(await host.join(request, sam.certificate, undefined)).toEqual({
      ok: false,
      error: 'certificate-mismatch',
    })
  })

  it('refuses a PIN that is not 4 to 6 digits', async () => {
    const host = vouching()

    expect(await join(host, await person(), 'Sam', '12')).toEqual({
      ok: false,
      error: 'bad-pin',
    })
  })
})

describe('vouching for a new device', () => {
  it('lets a band of five re-join, confirmed by the operator', async () => {
    const host = vouching()
    const names = ['Sam', 'Alex', 'Jo', 'Kim', 'Ray']
    const ids = []
    for (const name of names) {
      const someone = await person()
      await join(host, someone, name)
      ids.push(await requestId(host, someone.personKey))
    }
    expect(host.pending().map((entry) => entry.personName)).toEqual(names)

    for (const id of ids) {
      const vouch = await host.confirm(id)
      const check = vouch && (await checkDeviceVouch(vouch))
      expect(check).toMatchObject({
        ok: true,
        vouch: {
          payload: { hostKey, hostLabel: 'Studio Mac', method: 'operator' },
        },
      })
      expect(host.status(id)).toEqual({ status: 'vouched', vouch })
    }
    expect(host.pending()).toEqual([])
  })

  it("points the vouch back to the person's first certificate", async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam', '4821')
    const id = await requestId(host, sam.personKey)

    const result = await host.enterPin(id, '4821')

    expect(result).toMatchObject({
      ok: true,
      vouch: {
        payload: {
          personKey: sam.personKey,
          personName: 'Sam',
          deviceLabel: 'New phone',
          method: 'pin',
          firstCertificate: await statementAddress(sam.certificate),
        },
      },
    })
  })

  it('locks the PIN per person, across new device keys', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam', '4821')

    // Each guess comes from a fresh device key, as a guesser would do.
    const answers = []
    for (let i = 0; i < MAX_PIN_FAILURES; i++) {
      answers.push(
        await host.enterPin(await requestId(host, sam.personKey), '0000'),
      )
    }
    expect(answers.at(0)).toEqual({
      ok: false,
      error: 'wrong-pin',
      attemptsLeft: MAX_PIN_FAILURES - 1,
    })
    expect(answers.at(-1)).toEqual({ ok: false, error: 'locked' })

    const id = await requestId(host, sam.personKey)
    expect(await host.enterPin(id, '4821')).toEqual({
      ok: false,
      error: 'locked',
    })
    expect(await host.roster()).toMatchObject([{ pinLocked: true }])
    // The operator path stays open.
    expect(await host.confirm(id)).toBeDefined()
  })

  it('refuses a PIN for a person who set none', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam')

    expect(
      await host.enterPin(await requestId(host, sam.personKey), '4821'),
    ).toEqual({ ok: false, error: 'no-pin' })
  })

  it('refuses a request for a person not on the roster', async () => {
    const host = vouching()

    expect(
      await host.request(await newDevice((await person()).personKey)),
    ).toEqual({ ok: false, error: 'unknown-person' })
  })

  it('keeps one entry when a device asks twice', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam')
    const request = await newDevice(sam.personKey)

    expect(await host.request(request)).toEqual(await host.request(request))
    expect(host.pending()).toHaveLength(1)
  })

  it('keeps one entry when a device asks twice at once', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam')
    const request = await newDevice(sam.personKey)

    const [first, second] = await Promise.all([
      host.request(request),
      host.request(request),
    ])

    expect(first).toEqual(second)
    expect(host.pending()).toHaveLength(1)
  })

  it('caps waiting requests and drops stale ones', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam')
    for (let i = 0; i < MAX_PENDING; i++) {
      await requestId(host, sam.personKey)
    }

    expect(await host.request(await newDevice(sam.personKey))).toEqual({
      ok: false,
      error: 'too-many-pending',
    })
    clock += PENDING_TTL_MS + 1
    expect(host.pending()).toEqual([])
  })

  it('does not vouch twice for one request', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam', '4821')
    const id = await requestId(host, sam.personKey)

    expect(await host.confirm(id)).toBeDefined()
    expect(await host.confirm(id)).toBeUndefined()
    expect(await host.enterPin(id, '4821')).toEqual({
      ok: false,
      error: 'not-pending',
    })
  })

  it('tells the guest a rejected request was rejected', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam')
    const id = await requestId(host, sam.personKey)
    const before = changes

    host.reject(id)

    expect(host.status(id)).toEqual({ status: 'rejected' })
    expect(changes).toBe(before + 1)
  })
})

/** Guesses wrong PINs until the person is locked out. */
async function lockOut(host: ReturnType<typeof vouching>, personKey: string) {
  for (let i = 0; i < MAX_PIN_FAILURES; i++) {
    await host.enterPin(await requestId(host, personKey), '0000')
  }
}

describe('managing PINs', () => {
  it('keeps the wrong-PIN count across a restart', async () => {
    const sam = await person()
    let host = vouching()
    await join(host, sam, 'Sam', '4821')
    for (let i = 0; i < MAX_PIN_FAILURES - 1; i++) {
      await host.enterPin(await requestId(host, sam.personKey), '0000')
    }

    roster = createPersonRoster(path.join(dir, 'people.json'))
    host = vouching()

    expect(
      await host.enterPin(await requestId(host, sam.personKey), '0000'),
    ).toEqual({ ok: false, error: 'locked' })
    roster = createPersonRoster(path.join(dir, 'people.json'))
    expect(await vouching().roster()).toMatchObject([{ pinLocked: true }])
  })

  it('counts parallel guesses one at a time', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam', '4821')
    const ids = await Promise.all(
      Array.from({ length: MAX_PIN_FAILURES + 3 }, () =>
        requestId(host, sam.personKey),
      ),
    )

    const answers = await Promise.all(
      ids.map((id) => host.enterPin(id, '0000')),
    )

    const wrong = answers.filter(
      (answer) => !answer.ok && answer.error === 'wrong-pin',
    )
    expect(wrong).toHaveLength(MAX_PIN_FAILURES - 1)
  })

  it('resets the count after a right PIN', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam', '4821')
    await host.enterPin(await requestId(host, sam.personKey), '0000')

    await host.enterPin(await requestId(host, sam.personKey), '4821')

    expect(
      await host.enterPin(await requestId(host, sam.personKey), '0000'),
    ).toMatchObject({ attemptsLeft: MAX_PIN_FAILURES - 1 })
  })

  it('lets the operator unlock a locked PIN', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam', '4821')
    await lockOut(host, sam.personKey)

    expect(await host.unlockPin(sam.personKey)).toBe(true)

    expect(await host.roster()).toMatchObject([{ pinLocked: false }])
    const id = await requestId(host, sam.personKey)
    expect((await host.enterPin(id, '4821')).ok).toBe(true)
  })

  it('does not unlock a person not on the roster', async () => {
    const sam = await person()
    expect(await vouching().unlockPin(sam.personKey)).toBe(false)
  })

  it('lets the operator set and remove a PIN', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam')

    expect(await host.setPin(sam.personKey, '1357')).toEqual({ ok: true })
    expect(
      (await host.enterPin(await requestId(host, sam.personKey), '1357')).ok,
    ).toBe(true)

    expect(await host.setPin(sam.personKey, null)).toEqual({ ok: true })
    expect(await host.roster()).toMatchObject([{ hasPin: false }])
    expect(await host.setPin(sam.personKey, '12')).toEqual({
      ok: false,
      error: 'bad-pin',
    })
  })

  it('clears a lockout when the operator sets a new PIN', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam', '4821')
    await lockOut(host, sam.personKey)

    await host.setPin(sam.personKey, '1357')

    expect(await host.roster()).toMatchObject([{ pinLocked: false }])
  })

  it('lets the person key replace or remove the PIN by joining again', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam', '4821')
    await lockOut(host, sam.personKey)

    expect(await join(host, sam, 'Sam', '9999')).toEqual({ ok: true })
    expect(await host.roster()).toMatchObject([{ pinLocked: false }])
    const id = await requestId(host, sam.personKey)
    expect((await host.enterPin(id, '9999')).ok).toBe(true)

    await join(host, sam, 'Sam', null)
    expect(await host.roster()).toMatchObject([{ hasPin: false }])
  })

  it('changes the PIN given the old one', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam', '4821')

    expect(await host.changePin(sam.personKey, '4821', '2468')).toEqual({
      ok: true,
    })

    const id = await requestId(host, sam.personKey)
    expect(await host.enterPin(id, '4821')).toMatchObject({
      error: 'wrong-pin',
    })
    expect((await host.enterPin(id, '2468')).ok).toBe(true)
  })

  it('removes the PIN given the old one', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam', '4821')

    expect(await host.changePin(sam.personKey, '4821', null)).toEqual({
      ok: true,
    })
    expect(await host.roster()).toMatchObject([{ hasPin: false }])
  })

  it('counts a wrong old PIN against the same limit', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam', '4821')

    for (let i = 0; i < MAX_PIN_FAILURES - 1; i++) {
      await host.changePin(sam.personKey, '0000', '2468')
    }
    expect(
      await host.enterPin(await requestId(host, sam.personKey), '0000'),
    ).toEqual({ ok: false, error: 'locked' })
    expect(await host.changePin(sam.personKey, '4821', '2468')).toEqual({
      ok: false,
      error: 'locked',
    })
  })

  it('refuses a PIN change for a bad PIN or an unknown person', async () => {
    const host = vouching()
    const sam = await person()
    expect(await host.changePin(sam.personKey, '4821', '2468')).toEqual({
      ok: false,
      error: 'unknown-person',
    })
    await join(host, sam, 'Sam', '4821')
    expect(await host.changePin(sam.personKey, '4821', '12')).toEqual({
      ok: false,
      error: 'bad-pin',
    })
  })
})

describe('revoking a vouch the host signed', () => {
  it('remembers each vouch it signs, newest first', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam')
    const id = await requestId(host, sam.personKey)

    const vouch = await host.confirm(id)

    expect(await host.signedVouches()).toEqual([
      {
        address: await statementAddress(vouch!),
        personKey: sam.personKey,
        personName: 'Sam',
        deviceKey: vouch!.payload.deviceKey,
        deviceLabel: 'New phone',
        deviceFingerprint: expect.any(String),
        method: 'operator',
        vouchedAt: vouch!.payload.vouchedAt,
      },
    ])
  })

  it('signs a revocation for the vouch and marks it withdrawn', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam')
    const vouch = await host.confirm(await requestId(host, sam.personKey))
    const address = await statementAddress(vouch!)

    const result = await host.revokeVouch(address, { docUrl: 'automerge:root' })

    expect(result).toEqual({
      ok: true,
      address: expect.any(String),
      listedOn: ['automerge:recording'],
    })
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({
      docUrl: 'automerge:root',
      deviceLink: address,
    })
    const signed = parseSignedStatement(delivered[0].bytes)
    const check = await checkDeviceRevocation(signed!)
    expect(check.ok && check.revocation.payload).toEqual({
      type: 'tapes/revocation@1',
      signerKey: hostKey,
      signedBy: 'host',
      deviceKey: vouch!.payload.deviceKey,
      deviceLink: address,
      reason: 'wrong-person',
      revokedAt: new Date(clock).toISOString(),
    })
    expect(await host.signedVouches()).toMatchObject([
      {
        revokedAt: new Date(clock).toISOString(),
        revocation: result.ok ? result.address : '',
      },
    ])
  })

  it('refuses a second revocation, and one for a vouch it never signed', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam')
    const vouch = await host.confirm(await requestId(host, sam.personKey))
    const address = await statementAddress(vouch!)
    await host.revokeVouch(address, { docUrl: 'automerge:root' })

    expect(
      await host.revokeVouch(address, { docUrl: 'automerge:root' }),
    ).toEqual({
      ok: false,
      error: 'already-revoked',
    })
    expect(
      await host.revokeVouch('ff'.repeat(32), { docUrl: 'automerge:root' }),
    ).toEqual({ ok: false, error: 'unknown-vouch' })
  })

  it('withdraws a vouch no recording names', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam')
    const vouch = await host.confirm(await requestId(host, sam.personKey))
    // A device the host confirmed for the wrong person may never have
    // recorded anything, and the vouch is still withdrawn.
    listedOn = []

    const result = await host.revokeVouch(await statementAddress(vouch!), {
      docUrl: 'automerge:root',
    })

    expect(result).toMatchObject({ ok: true, listedOn: [] })
    expect(await host.signedVouches()).toMatchObject([
      { revokedAt: new Date(clock).toISOString() },
    ])
  })

  it('survives a restart, because the roster holds the vouches', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam')
    const vouch = await host.confirm(await requestId(host, sam.personKey))

    clock += PENDING_TTL_MS + 1
    const restarted = createHostVouching({
      roster: createPersonRoster(path.join(dir, 'people.json')),
      loadSigningKey: async () => hostKeys,
      hostLabel: () => 'Studio Mac',
      consumeChallenge: () => true,
      deliverRevocation: async () => listedOn,
      now: () => clock,
    })

    expect(
      await restarted.revokeVouch(await statementAddress(vouch!), {
        docUrl: 'automerge:root',
      }),
    ).toMatchObject({ ok: true })
  })

  it('refuses to sign without a way to deliver the revocation', async () => {
    const sam = await person()
    const host = createHostVouching({
      roster,
      loadSigningKey: async () => hostKeys,
      hostLabel: () => 'Studio Mac',
      consumeChallenge: (value) => issued.delete(value),
      now: () => clock,
    })
    await join(host, sam, 'Sam')
    const vouch = await host.confirm(await requestId(host, sam.personKey))

    expect(
      await host.revokeVouch(await statementAddress(vouch!), {
        docUrl: 'automerge:root',
      }),
    ).toEqual({ ok: false, error: 'no-delivery' })
  })
})
