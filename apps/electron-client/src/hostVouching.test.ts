import path from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkDeviceVouch,
  createDeviceCertificate,
  createJoinRequest,
  createVouchRequest,
  exportPublicKey,
  generateSigningKeyPair,
  statementAddress,
} from '@tapes-monorepo/provenance'
import {
  createHostVouching,
  MAX_PENDING,
  MAX_PIN_FAILURES,
  PENDING_TTL_MS,
} from './hostVouching'
import { createPersonRoster, type PersonRoster } from './personRoster'

let dir: string
let roster: PersonRoster
let clock: number
let issued: Set<string>
let changes: number

const hostKeys = await generateSigningKeyPair()
const hostKey = await exportPublicKey(hostKeys.publicKey)

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tapes-roster-'))
  roster = createPersonRoster(path.join(dir, 'people.json'))
  clock = Date.parse('2026-10-19T18:00:00.000Z')
  issued = new Set()
  changes = 0
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
  pin?: string,
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

  it('renames a person who joins again, and keeps their first PIN', async () => {
    const host = vouching()
    const sam = await person()
    await join(host, sam, 'Sam', '4821')

    await join(host, sam, 'Samantha', '9999')

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
