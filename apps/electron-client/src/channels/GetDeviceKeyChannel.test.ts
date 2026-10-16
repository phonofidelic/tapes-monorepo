import { describe, it, expect, vi } from 'vitest'
import {
  exportPublicKey,
  generateSigningKeyPair,
} from '@tapes-monorepo/provenance'
import { GetDeviceKeyChannel } from './GetDeviceKeyChannel'

vi.mock('@/hostSigningKey', () => ({ loadHostSigningKey: vi.fn() }))

describe('the device key channel', () => {
  it('answers with the public half of the signing key', async () => {
    const keyPair = await generateSigningKeyPair()

    const response = await new GetDeviceKeyChannel(async () => keyPair).handle()

    expect(response).toEqual({
      success: true,
      data: { publicKey: await exportPublicKey(keyPair.publicKey) },
    })
  })

  it('answers with a failure when the key cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await new GetDeviceKeyChannel(async () => {
      throw new Error('safeStorage unavailable')
    }).handle()

    expect(response).toEqual({ success: false, error: expect.any(Error) })
  })
})
