import { EventEmitter } from 'events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Covers the two ways recording can fail without anyone hearing about it: a
 * sox that never starts, and a sox that never stops. Both used to end with the
 * renderer holding a promise it could not act on.
 */

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }))

vi.mock('child_process', () => ({ execFile }))
vi.mock('electron', () => ({ app: { getAppPath: () => '/tapes' } }))

/** A sox that behaves however the test says, with the streams the real one has. */
class FakeSox extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  readonly signals: string[] = []

  kill(signal: string) {
    this.signals.push(signal)
    return true
  }
}

let sox: FakeSox

const startOptions = {
  storageLocation: '/tapes/recordings',
  audioChannelCount: 1,
  audioFormat: 'wav' as const,
}

const newRecorder = async () => {
  const { SoxRecorder } = await import('./soxRecorder')
  return new SoxRecorder()
}

beforeEach(() => {
  vi.resetModules()
  // Picks the development branch of the binary path. The packaged branch reads
  // a property only a real Electron process has.
  vi.stubEnv('NODE_ENV', 'development')
  sox = new FakeSox()
  execFile.mockReturnValue(sox)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('starting', () => {
  it('resolves once the process is running', async () => {
    const recorder = await newRecorder()

    const started = recorder.start(startOptions)
    sox.emit('spawn')

    await expect(started).resolves.toBeUndefined()
  })

  // execFile reports a missing binary on the error event rather than throwing,
  // so a start that only watched for a throw always looked like it worked.
  it('rejects when the binary will not run', async () => {
    const recorder = await newRecorder()

    const started = recorder.start(startOptions)
    sox.emit('error', new Error('spawn ENOENT'))

    await expect(started).rejects.toThrow('spawn ENOENT')
  })

  it('leaves no recording in progress after a failed start', async () => {
    const recorder = await newRecorder()

    const started = recorder.start(startOptions)
    sox.emit('error', new Error('spawn ENOENT'))
    await expect(started).rejects.toThrow()

    await expect(recorder.stop()).rejects.toThrow('No recording is in progress')
  })
})

describe('stopping', () => {
  const startedRecorder = async () => {
    const recorder = await newRecorder()
    const started = recorder.start(startOptions)
    sox.emit('spawn')
    await started
    return recorder
  }

  it('interrupts sox and returns the file it wrote', async () => {
    const recorder = await startedRecorder()

    const stopped = recorder.stop()
    sox.emit('close')

    await expect(stopped).resolves.toMatch(/^\/tapes\/recordings\/.+\.wav$/)
    // SIGINT, so sox patches the wav header on its way out.
    expect(sox.signals).toEqual(['SIGINT'])
  })

  // Without the timeout the handler never returns, and the renderer waits on
  // an answer that never comes.
  it('kills a sox that ignores the interrupt', async () => {
    vi.useFakeTimers()
    const recorder = await startedRecorder()

    const stopped = recorder.stop()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(sox.signals).toEqual(['SIGINT', 'SIGKILL'])

    sox.emit('close')
    await expect(stopped).resolves.toContain('/tapes/recordings/')
  })

  it('rejects when nothing is recording', async () => {
    const recorder = await newRecorder()

    await expect(recorder.stop()).rejects.toThrow('No recording is in progress')
  })
})
