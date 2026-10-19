// THROWAWAY PROTOTYPE (TAP-219).
import { describe, expect, it } from 'vitest'
import {
  exportPublicKey,
  generateSigningKeyPair,
} from '@tapes-monorepo/provenance'
import { createHostVouching, emptyState, MAX_PENDING } from './hostVouching'
import {
  checkDeviceVouch,
  createPersonCertificate,
  createVouchRequest,
} from './statements'

async function setup(names = ['Sam']) {
  const host = await generateSigningKeyPair()
  const hostKey = await exportPublicKey(host.publicKey)
  let clock = Date.parse('2026-10-19T18:00:00.000Z')
  const now = () => new Date(clock)
  const vouching = createHostVouching({
    state: emptyState(),
    hostKeyPair: host,
    now,
    maxPinFailures: 3,
  })
  const people = []
  for (const name of names) {
    const person = await generateSigningKeyPair()
    const device = await generateSigningKeyPair()
    const cert = await createPersonCertificate(
      { deviceKey: await exportPublicKey(device.publicKey), issuedAt: now() },
      person,
    )
    const enrolled = await vouching.enroll(cert, name, '4821')
    expect(enrolled.ok).toBe(true)
    people.push({ name, personKey: await exportPublicKey(person.publicKey) })
  }
  const newRequest = async (personKey: string) =>
    createVouchRequest(
      { personKey, requestedAt: now() },
      await generateSigningKeyPair(),
    )
  const tick = (ms: number) => {
    clock += ms
  }
  return { vouching, hostKey, people, newRequest, tick }
}

describe('host vouching', () => {
  it('lets a band of five re-join and be confirmed by the operator', async () => {
    const names = ['Sam', 'Alex', 'Jo', 'Kim', 'Ray']
    const { vouching, hostKey, people, newRequest, tick } = await setup(names)

    const ids = []
    for (const person of people) {
      const result = await vouching.request(await newRequest(person.personKey))
      if (!result.ok) throw new Error(result.error)
      ids.push(result.id)
    }
    expect(vouching.pending().map((p) => p.personName)).toEqual(names)

    tick(4_000)
    for (const id of ids) {
      const vouch = await vouching.confirm(id)
      expect(vouch && (await checkDeviceVouch(vouch, [hostKey])).ok).toBe(true)
    }
    expect(vouching.pending()).toEqual([])
    expect(vouching.state.log.map((l) => l.waitedMs)).toEqual(
      Array(5).fill(4_000),
    )
  })

  it('vouches with method "pin" after the right PIN', async () => {
    const { vouching, people, newRequest } = await setup()
    const result = await vouching.request(await newRequest(people[0].personKey))
    if (!result.ok) throw new Error(result.error)

    const answer = await vouching.enterPin(result.id, '4821')
    expect(answer.ok && answer.vouch.payload.method).toBe('pin')
  })

  it('locks the PIN per person, across new device keys', async () => {
    const { vouching, people, newRequest } = await setup()
    const personKey = people[0].personKey

    // Each guess comes from a fresh device key, as a guesser would do.
    const answers = []
    for (let i = 0; i < 3; i++) {
      const result = await vouching.request(await newRequest(personKey))
      if (!result.ok) throw new Error(result.error)
      answers.push(await vouching.enterPin(result.id, '0000'))
    }
    expect(answers.map((a) => !a.ok && a.error)).toEqual([
      'wrong-pin',
      'wrong-pin',
      'locked',
    ])

    const fresh = await vouching.request(await newRequest(personKey))
    if (!fresh.ok) throw new Error(fresh.error)
    expect(await vouching.enterPin(fresh.id, '4821')).toEqual({
      ok: false,
      error: 'locked',
    })

    // The operator path still works while the PIN is locked.
    expect(await vouching.confirm(fresh.id)).toBeDefined()

    vouching.unlockPin(personKey)
    const after = await vouching.request(await newRequest(personKey))
    if (!after.ok) throw new Error(after.error)
    expect((await vouching.enterPin(after.id, '4821')).ok).toBe(true)
  })

  it('refuses a request for a person it has never met', async () => {
    const { vouching, newRequest } = await setup()
    const stranger = await exportPublicKey(
      (await generateSigningKeyPair()).publicKey,
    )
    expect(await vouching.request(await newRequest(stranger))).toEqual({
      ok: false,
      error: 'unknown-person',
    })
  })

  it('keeps one entry when a device asks twice', async () => {
    const { vouching, people } = await setup()
    const device = await generateSigningKeyPair()
    const request = await createVouchRequest(
      { personKey: people[0].personKey, requestedAt: new Date() },
      device,
    )
    const first = await vouching.request(request)
    const second = await vouching.request(request)
    expect(first).toEqual(second)
    expect(vouching.pending()).toHaveLength(1)
  })

  it('caps pending requests and drops stale ones', async () => {
    const { vouching, people, newRequest, tick } = await setup()
    for (let i = 0; i < MAX_PENDING; i++) {
      expect(
        (await vouching.request(await newRequest(people[0].personKey))).ok,
      ).toBe(true)
    }
    expect(
      await vouching.request(await newRequest(people[0].personKey)),
    ).toEqual({ ok: false, error: 'too-many-pending' })
    tick(11 * 60_000)
    expect(vouching.pending()).toEqual([])
  })

  it('does not vouch twice for one request', async () => {
    const { vouching, people, newRequest } = await setup()
    const result = await vouching.request(await newRequest(people[0].personKey))
    if (!result.ok) throw new Error(result.error)
    expect(await vouching.confirm(result.id)).toBeDefined()
    expect(await vouching.confirm(result.id)).toBeUndefined()
    expect(await vouching.enterPin(result.id, '4821')).toEqual({
      ok: false,
      error: 'not-pending',
    })
  })
})
