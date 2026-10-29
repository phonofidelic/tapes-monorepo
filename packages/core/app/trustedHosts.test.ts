import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isTrustedHost,
  readTrustedHosts,
  subscribeToTrustedHosts,
  trustHost,
  untrustHost,
} from './trustedHosts'

const STUDIO = { hostKey: 'studio-key', hostLabel: 'Studio Mac' }
const STAGE = { hostKey: 'stage-key', hostLabel: 'Stage Mac' }

describe('trusted hosts', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('trusts nobody to begin with', () => {
    expect(readTrustedHosts()).toEqual([])
    expect(isTrustedHost(STUDIO.hostKey)).toBe(false)
    expect(isTrustedHost(undefined)).toBe(false)
  })

  it('keeps a trusted host with its label', () => {
    trustHost({ ...STUDIO, trustedAt: new Date('2026-10-28T09:00:00.000Z') })

    expect(readTrustedHosts()).toEqual([
      { ...STUDIO, trustedAt: '2026-10-28T09:00:00.000Z' },
    ])
    expect(isTrustedHost(STUDIO.hostKey)).toBe(true)
  })

  it('lists the most recently trusted host first', () => {
    trustHost({ ...STUDIO, trustedAt: new Date('2026-10-28T09:00:00.000Z') })
    trustHost({ ...STAGE, trustedAt: new Date('2026-10-29T09:00:00.000Z') })

    expect(readTrustedHosts().map((host) => host.hostKey)).toEqual([
      STAGE.hostKey,
      STUDIO.hostKey,
    ])
  })

  // The operator acts on a vouch, and a host can have renamed itself since
  // the one they acted on before.
  it('takes the newer label when a host is trusted again', () => {
    trustHost(STUDIO)
    trustHost({ hostKey: STUDIO.hostKey, hostLabel: 'Studio Mac mini' })

    expect(readTrustedHosts()).toHaveLength(1)
    expect(readTrustedHosts()[0]!.hostLabel).toBe('Studio Mac mini')
  })

  it('drops a host again', () => {
    trustHost(STUDIO)
    trustHost(STAGE)
    untrustHost(STUDIO.hostKey)

    expect(isTrustedHost(STUDIO.hostKey)).toBe(false)
    expect(isTrustedHost(STAGE.hostKey)).toBe(true)
  })

  it('tells subscribers about every change', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToTrustedHosts(listener)

    trustHost(STUDIO)
    untrustHost(STUDIO.hostKey)
    unsubscribe()
    trustHost(STAGE)

    expect(listener).toHaveBeenCalledTimes(2)
  })

  // The snapshot is compared by identity by `useSyncExternalStore`, so an
  // unchanged list has to stay the same array.
  it('returns the same list until something changes', () => {
    trustHost(STUDIO)
    const first = readTrustedHosts()

    expect(readTrustedHosts()).toBe(first)

    trustHost(STAGE)
    expect(readTrustedHosts()).not.toBe(first)
  })

  it('trusts nobody when the stored list is corrupt', () => {
    localStorage.setItem('tapes.trustedHosts', 'not json')

    expect(readTrustedHosts()).toEqual([])
    expect(isTrustedHost(STUDIO.hostKey)).toBe(false)
  })
})
