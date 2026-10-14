import { describe, expect, it } from 'vitest'
import { syncChallengeUrl, withSyncProof } from './syncProof'

describe('withSyncProof', () => {
  it('adds the proof next to the other parameters', () => {
    expect(withSyncProof('ws://127.0.0.1:9001/?t=secret', 'abc')).toBe(
      'ws://127.0.0.1:9001/?t=secret&p=abc',
    )
  })

  it('replaces an earlier proof', () => {
    expect(
      withSyncProof(withSyncProof('ws://127.0.0.1:9001', 'old'), 'new'),
    ).toBe('ws://127.0.0.1:9001/?p=new')
  })
})

describe('syncChallengeUrl', () => {
  it('maps ws to http on the same host and port', () => {
    expect(syncChallengeUrl('ws://192.168.1.5:9001/?t=secret&d=Phone')).toBe(
      'http://192.168.1.5:9001/challenge',
    )
  })

  it('maps wss to https and drops the sync path', () => {
    expect(syncChallengeUrl('wss://192.168.1.5:5173/sync?t=secret')).toBe(
      'https://192.168.1.5:5173/challenge',
    )
  })
})
