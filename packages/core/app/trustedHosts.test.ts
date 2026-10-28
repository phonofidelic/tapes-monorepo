import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { VerifiedPerson } from '@tapes-monorepo/provenance'
import type { AppContextValue } from '@/context/AppContext'
import type { IpcService } from '@/IpcService'
import {
  creditForPerson,
  readTrustedHosts,
  refreshTrustedHosts,
  subscribeToTrustedHosts,
  trustHost,
  untrustHost,
} from './trustedHosts'

const DEVICE_KEY = 'device-key'
const PERSON_KEY = 'person-key'
const HOST_KEY = 'host-key'

const vouch = (overrides: Partial<VerifiedPerson> = {}): VerifiedPerson =>
  ({
    via: 'vouch',
    personKey: PERSON_KEY,
    personName: 'Sam',
    deviceLabel: 'Pixel · Chrome',
    hostKey: HOST_KEY,
    hostLabel: 'Studio Mac',
    method: 'operator',
    vouchedAt: '2026-10-05T11:50:00.000Z',
    ...overrides,
  }) as VerifiedPerson

const certificate = (): VerifiedPerson => ({
  via: 'certificate',
  personKey: PERSON_KEY,
  deviceLabel: 'Pixel · Chrome',
  issuedAt: '2026-10-05T11:50:00.000Z',
})

const credit = (
  person: VerifiedPerson,
  reader: Parameters<typeof creditForPerson>[1],
) => creditForPerson({ deviceKey: DEVICE_KEY, person }, reader)

describe('creditForPerson', () => {
  it('does not count a vouch from a host that is not trusted', () => {
    expect(credit(vouch(), { trustedHostKeys: new Set() })).toEqual({
      counts: false,
    })
  })

  it('counts a vouch from a trusted host', () => {
    expect(credit(vouch(), { trustedHostKeys: new Set([HOST_KEY]) })).toEqual({
      counts: true,
      because: 'trusted-host',
    })
  })

  it('does not count a vouch from a host whose key only looks similar', () => {
    expect(
      credit(vouch(), { trustedHostKeys: new Set(['host-key-other']) }),
    ).toEqual({ counts: false })
  })

  // A certificate is the person's own signature, so trust never enters into it.
  it('counts a certificate whatever the reader trusts', () => {
    expect(credit(certificate(), { trustedHostKeys: new Set() })).toEqual({
      counts: true,
      because: 'certified-device',
    })
  })

  it('counts a vouch the person key has since certified the device for', () => {
    expect(
      credit(vouch(), {
        trustedHostKeys: new Set(),
        certifiedDevice: { personKey: PERSON_KEY, deviceKey: DEVICE_KEY },
      }),
    ).toEqual({ counts: true, because: 'certified-device' })
  })

  // The certificate settles it, so an untrusted host is no longer a reason to
  // label the vouch.
  it('prefers the certificate over the host when both would count it', () => {
    expect(
      credit(vouch(), {
        trustedHostKeys: new Set([HOST_KEY]),
        certifiedDevice: { personKey: PERSON_KEY, deviceKey: DEVICE_KEY },
      }),
    ).toEqual({ counts: true, because: 'certified-device' })
  })

  it('ignores a certificate for another device of the same person', () => {
    expect(
      credit(vouch(), {
        trustedHostKeys: new Set(),
        certifiedDevice: { personKey: PERSON_KEY, deviceKey: 'other-device' },
      }),
    ).toEqual({ counts: false })
  })

  it('ignores a certificate for the same device held by another person', () => {
    expect(
      credit(vouch(), {
        trustedHostKeys: new Set(),
        certifiedDevice: { personKey: 'other-person', deviceKey: DEVICE_KEY },
      }),
    ).toEqual({ counts: false })
  })
})

const electron = (send: IpcService['send']): AppContextValue => ({
  type: 'electron-client',
  ipc: { send } as unknown as IpcService,
})

const web: AppContextValue = {
  type: 'web-client',
  worker: {} as unknown as Worker,
}

const hosts = [{ hostKey: HOST_KEY, addedAt: 'now' }]

describe('readTrustedHosts', () => {
  beforeEach(() => refreshTrustedHosts())

  it('reads the host list over IPC', async () => {
    const send = vi.fn().mockResolvedValue({ success: true, data: { hosts } })

    expect(await readTrustedHosts(electron(send))).toEqual(hosts)
    expect(send).toHaveBeenCalledWith('trust:get-hosts')
  })

  // Every Library row asks, and the answer cannot change without a write.
  it('asks the host once and shares the answer', async () => {
    const send = vi.fn().mockResolvedValue({ success: true, data: { hosts } })
    const context = electron(send)

    await Promise.all([readTrustedHosts(context), readTrustedHosts(context)])
    await readTrustedHosts(context)

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('trusts nothing on a client with no host of its own', async () => {
    expect(await readTrustedHosts(web)).toEqual([])
  })

  // A reader that cannot tell must label the vouch, not count it.
  it('trusts nothing when the host cannot answer', async () => {
    const send = vi.fn().mockRejectedValue(new Error('no channel'))

    expect(await readTrustedHosts(electron(send))).toEqual([])
  })

  it('trusts nothing when the host reports a failure', async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ success: false, error: new Error('unreadable') })

    expect(await readTrustedHosts(electron(send))).toEqual([])
  })
})

describe('changing the list', () => {
  beforeEach(() => refreshTrustedHosts())

  it('trusts a host with the name from its vouch', async () => {
    const send = vi.fn().mockResolvedValue({ success: true })

    expect(
      await trustHost(electron(send), {
        hostKey: HOST_KEY,
        hostLabel: 'Studio Mac',
      }),
    ).toBe(true)
    expect(send).toHaveBeenCalledWith('trust:add-host', {
      data: { hostKey: HOST_KEY, hostLabel: 'Studio Mac' },
    })
  })

  it('leaves out a name it does not have', async () => {
    const send = vi.fn().mockResolvedValue({ success: true })
    await trustHost(electron(send), { hostKey: HOST_KEY })

    expect(send).toHaveBeenCalledWith('trust:add-host', {
      data: { hostKey: HOST_KEY },
    })
  })

  it('removes a key', async () => {
    const send = vi.fn().mockResolvedValue({ success: true })

    expect(await untrustHost(electron(send), HOST_KEY)).toBe(true)
    expect(send).toHaveBeenCalledWith('trust:remove-host', {
      data: { hostKey: HOST_KEY },
    })
  })

  it('reports a key the host refused', async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ success: false, error: new Error('not a key') })

    expect(await trustHost(electron(send), { hostKey: 'nonsense' })).toBe(false)
  })

  it('changes nothing on a client with no host of its own', async () => {
    expect(await trustHost(web, { hostKey: HOST_KEY })).toBe(false)
    expect(await untrustHost(web, HOST_KEY)).toBe(false)
  })

  // Rows across the Library must rename the person together.
  it('tells the readers to read the list again after a change', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: { hosts: [] } })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true, data: { hosts } })
    const context = electron(send)
    const listener = vi.fn()
    const unsubscribe = subscribeToTrustedHosts(listener)

    await readTrustedHosts(context)
    await trustHost(context, { hostKey: HOST_KEY })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(await readTrustedHosts(context)).toEqual(hosts)
    unsubscribe()
  })

  it('stops telling a reader that has unsubscribed', async () => {
    const listener = vi.fn()
    subscribeToTrustedHosts(listener)()

    refreshTrustedHosts()

    expect(listener).not.toHaveBeenCalled()
  })
})
