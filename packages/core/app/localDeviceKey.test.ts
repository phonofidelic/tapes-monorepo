import { describe, expect, it, vi } from 'vitest'
import type { AppContextValue } from '@/context/AppContext'
import type { IpcService } from '@/IpcService'
import { callWorker } from '@/workerClient'
import { readLocalDeviceKey } from './localDeviceKey'

vi.mock('@/workerClient', () => ({ callWorker: vi.fn() }))

const KEY = 'k'.repeat(43)

const electron = (send: IpcService['send']): AppContextValue => ({
  type: 'electron-client',
  ipc: { send } as IpcService,
})

const web = (): AppContextValue => ({
  type: 'web-client',
  worker: {} as Worker,
})

describe('readLocalDeviceKey', () => {
  it('asks the storage worker on the web', async () => {
    vi.mocked(callWorker).mockResolvedValueOnce({ publicKey: KEY })
    const context = web()

    expect(await readLocalDeviceKey(context)).toBe(KEY)
    expect(callWorker).toHaveBeenCalledWith(
      context.type === 'web-client' && context.worker,
      'provenance:device-key',
    )
  })

  it('asks the main process on the desktop', async () => {
    const send = vi.fn().mockResolvedValue({
      success: true,
      data: { publicKey: KEY },
    })

    expect(await readLocalDeviceKey(electron(send))).toBe(KEY)
    expect(send).toHaveBeenCalledWith('provenance:get-device-key')
  })

  it('asks once per app context', async () => {
    const send = vi.fn().mockResolvedValue({
      success: true,
      data: { publicKey: KEY },
    })
    const context = electron(send)

    await readLocalDeviceKey(context)
    await readLocalDeviceKey(context)

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('resolves undefined when the backend has no key', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(callWorker).mockRejectedValueOnce(new Error('no Ed25519 here'))
    const send = vi.fn().mockResolvedValue({
      success: false,
      error: new Error('safeStorage unavailable'),
    })

    expect(await readLocalDeviceKey(web())).toBeUndefined()
    expect(await readLocalDeviceKey(electron(send))).toBeUndefined()
  })
})
