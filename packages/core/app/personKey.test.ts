import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRecordingClaim,
  encodeSignedStatement,
  generateSigningKeyPair,
} from '@tapes-monorepo/provenance'
import type { AppContextValue } from '@/context/AppContext'
import type { IpcService } from '@/IpcService'
import { callWorker } from '@/workerClient'
import { certificateForClaim, readPersonKeyStatus } from './personKey'

vi.mock('@/workerClient', () => ({ callWorker: vi.fn() }))

const web: AppContextValue = {
  type: 'web-client',
  worker: {} as Worker,
}
const electron: AppContextValue = {
  type: 'electron-client',
  ipc: {} as IpcService,
}

const CERT_ADDRESS = 'cd'.repeat(32)

async function claimNaming(deviceCert?: string) {
  return encodeSignedStatement(
    await createRecordingClaim(
      {
        blob: { hash: 'ab'.repeat(32), size: 1, mimeType: 'audio/mp4' },
        startedAt: '2026-10-22T10:00:00.000Z',
        endedAt: '2026-10-22T10:01:00.000Z',
        deviceCert,
      },
      await generateSigningKeyPair(),
    ),
  )
}

beforeEach(() => {
  vi.mocked(callWorker).mockReset()
  vi.mocked(callWorker).mockResolvedValue({
    exists: true,
    publicKey: 'person-key',
    certificate: 'encoded-certificate',
    certificateAddress: CERT_ADDRESS,
  })
})

describe('readPersonKeyStatus', () => {
  it('asks the worker on the web', async () => {
    expect(await readPersonKeyStatus(web)).toMatchObject({ exists: true })
    expect(callWorker).toHaveBeenCalledWith(web.worker, 'person:status')
  })

  it('reports none on the desktop host', async () => {
    expect(await readPersonKeyStatus(electron)).toEqual({ exists: false })
    expect(callWorker).not.toHaveBeenCalled()
  })
})

describe('certificateForClaim', () => {
  it('returns the certificate the claim names', async () => {
    expect(
      await certificateForClaim(web, await claimNaming(CERT_ADDRESS)),
    ).toBe('encoded-certificate')
  })

  it('returns nothing for a claim that names no certificate', async () => {
    expect(await certificateForClaim(web, await claimNaming())).toBeUndefined()
    expect(await certificateForClaim(web, undefined)).toBeUndefined()
    expect(callWorker).not.toHaveBeenCalled()
  })

  it('returns nothing when this device holds a different certificate', async () => {
    expect(
      await certificateForClaim(web, await claimNaming('ef'.repeat(32))),
    ).toBeUndefined()
  })

  it('uploads without it when the worker fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(callWorker).mockRejectedValue(new Error('no IndexedDB'))

    expect(
      await certificateForClaim(web, await claimNaming(CERT_ADDRESS)),
    ).toBeUndefined()
  })
})
