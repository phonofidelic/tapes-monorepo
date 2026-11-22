import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLocalName,
  localNameClashes,
  readLocalName,
  readLocalNames,
  setLocalName,
  subscribeToLocalNames,
} from './localNames'

const PHONE = { key: 'phone-key', kind: 'device' as const }
const SAM = { key: 'sam-key', kind: 'person' as const }

describe('local names', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('knows no names to begin with', () => {
    expect(readLocalNames()).toEqual([])
    expect(readLocalName(PHONE.key)).toBeUndefined()
    expect(readLocalName(undefined)).toBeUndefined()
  })

  it('reads back a name the operator saved', () => {
    setLocalName({
      ...PHONE,
      name: 'Studio phone',
      namedAt: new Date('2026-11-22T09:00:00.000Z'),
    })

    expect(readLocalName(PHONE.key)).toBe('Studio phone')
    expect(readLocalNames()).toEqual([
      {
        key: PHONE.key,
        kind: 'device',
        name: 'Studio phone',
        namedAt: '2026-11-22T09:00:00.000Z',
      },
    ])
  })

  it('lists the most recently named key first', () => {
    setLocalName({
      ...PHONE,
      name: 'Studio phone',
      namedAt: new Date('2026-11-21T09:00:00.000Z'),
    })
    setLocalName({
      ...SAM,
      name: 'Sam',
      namedAt: new Date('2026-11-22T09:00:00.000Z'),
    })

    expect(readLocalNames().map((each) => each.key)).toEqual([
      SAM.key,
      PHONE.key,
    ])
  })

  it('replaces a name rather than keeping both', () => {
    setLocalName({ ...PHONE, name: 'Studio phone' })
    setLocalName({ ...PHONE, name: 'Sam’s phone' })

    expect(readLocalName(PHONE.key)).toBe('Sam’s phone')
    expect(readLocalNames()).toHaveLength(1)
  })

  it('trims what the operator typed', () => {
    setLocalName({ ...PHONE, name: '  Studio phone  ' })

    expect(readLocalName(PHONE.key)).toBe('Studio phone')
  })

  // One control both names and unnames, so an emptied field is not a name.
  it('forgets the name when nothing printable is left', () => {
    setLocalName({ ...PHONE, name: 'Studio phone' })
    setLocalName({ ...PHONE, name: '   ' })

    expect(readLocalName(PHONE.key)).toBeUndefined()
    expect(readLocalNames()).toEqual([])
  })

  it('forgets a name on request', () => {
    setLocalName({ ...PHONE, name: 'Studio phone' })
    clearLocalName(PHONE.key)

    expect(readLocalName(PHONE.key)).toBeUndefined()
  })

  it('tells its listeners after every change', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToLocalNames(listener)

    setLocalName({ ...PHONE, name: 'Studio phone' })
    clearLocalName(PHONE.key)
    unsubscribe()
    setLocalName({ ...PHONE, name: 'Studio phone' })

    expect(listener).toHaveBeenCalledTimes(2)
  })

  describe('duplicate names', () => {
    it('reports another key of the same kind wearing the name', () => {
      setLocalName({ ...PHONE, name: 'Studio phone' })

      expect(
        localNameClashes({
          key: 'other-phone-key',
          kind: 'device',
          name: 'Studio phone',
        }).map((each) => each.key),
      ).toEqual([PHONE.key])
    })

    it('ignores case and surrounding space', () => {
      setLocalName({ ...PHONE, name: 'Studio phone' })

      expect(
        localNameClashes({
          key: 'other-phone-key',
          kind: 'device',
          name: '  STUDIO PHONE ',
        }),
      ).toHaveLength(1)
    })

    // A person and their phone sharing a name is not a confusion worth a
    // warning, since the two are never shown as the same kind of thing.
    it('does not compare across kinds', () => {
      setLocalName({ ...SAM, name: 'Sam' })

      expect(
        localNameClashes({ key: PHONE.key, kind: 'device', name: 'Sam' }),
      ).toEqual([])
    })

    it('does not report the key being renamed', () => {
      setLocalName({ ...PHONE, name: 'Studio phone' })

      expect(localNameClashes({ ...PHONE, name: 'Studio phone' })).toEqual([])
    })

    it('reports nothing for an empty name', () => {
      setLocalName({ ...PHONE, name: 'Studio phone' })

      expect(localNameClashes({ ...SAM, kind: 'device', name: ' ' })).toEqual(
        [],
      )
    })
  })

  describe('a store it cannot read', () => {
    it('falls back to no names on corrupt JSON', () => {
      localStorage.setItem('tapes.localNames', 'not json')

      expect(readLocalNames()).toEqual([])
      expect(readLocalName(PHONE.key)).toBeUndefined()
    })

    // A wrong name would be shown as recognition, so each entry is checked on
    // its own rather than the file being trusted as a whole.
    it('keeps the entries that are well formed and drops the rest', () => {
      localStorage.setItem(
        'tapes.localNames',
        JSON.stringify({
          [PHONE.key]: {
            kind: 'device',
            name: 'Studio phone',
            namedAt: '2026-11-22T09:00:00.000Z',
          },
          'no-kind-key': { name: 'Nameless', namedAt: '2026-11-22' },
          'empty-name-key': { kind: 'device', name: '', namedAt: '2026-11-22' },
          'odd-kind-key': {
            kind: 'router',
            name: 'Router',
            namedAt: '2026-11-22',
          },
        }),
      )

      expect(readLocalNames().map((each) => each.key)).toEqual([PHONE.key])
    })

    it('ignores a stored array', () => {
      localStorage.setItem('tapes.localNames', '["Studio phone"]')

      expect(readLocalNames()).toEqual([])
    })
  })
})
