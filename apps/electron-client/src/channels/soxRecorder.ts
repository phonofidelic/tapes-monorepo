import path from 'path'
import crypto from 'crypto'
import { execFile, ChildProcess } from 'child_process'
import { app } from 'electron'

const DEFAULT_SAMPLE_RATE = 44100

/** How long sox gets to shut down cleanly before it is killed outright. */
const STOP_TIMEOUT_MS = 5_000

/**
 * The one running sox process, shared by the start and stop channels.
 *
 * Recording spans two requests, so the process and its output path outlive
 * either handler. They live here rather than on the start channel, which would
 * otherwise have to register the stop handler itself.
 *
 * SoX: The Swiss Army knife of sound processing
 *
 * * Wikipedia: https://en.wikipedia.org/wiki/SoX
 * * Manual: https://explainshell.com/explain/1/sox
 * * Download: https://sourceforge.net/projects/sox
 */
export class SoxRecorder {
  private filepath: string | null = null
  private sox: ChildProcess | null = null
  private soxPath =
    process.env.NODE_ENV !== 'development'
      ? path.resolve(process.resourcesPath, 'sox-14.4.2-macOS')
      : path.resolve(app.getAppPath(), 'bin', 'sox-14.4.2-macOS')

  /** Begins recording, or throws if sox never started. */
  public async start(options: {
    storageLocation: string
    audioChannelCount: number
    audioFormat: 'mp3' | 'wav' | 'ogg' | 'flac'
  }) {
    const filepath = path.resolve(
      options.storageLocation,
      `${crypto.randomUUID()}.${options.audioFormat}`,
    )

    const sox = execFile(this.soxPath, [
      '--default-device',
      '--no-show-progress',
      `--type=${options.audioFormat === 'mp3' ? 'wav' : options.audioFormat}`,
      `--channels=${options.audioChannelCount}`,
      `--rate=${DEFAULT_SAMPLE_RATE}`,
      filepath,
    ])

    // A missing or unrunnable binary is reported on the error event, not
    // thrown, so waiting for one of the two is the only way to learn that
    // recording began. Reporting success here and failing at stop would tell
    // the user nothing until their take was already lost.
    await new Promise<void>((resolve, reject) => {
      sox.once('spawn', resolve)
      sox.once('error', reject)
    })

    if (!sox.stdout || !sox.stderr) {
      throw new Error('Failed to start sox process')
    }

    // Assigned only once the process is running, so a failed start leaves no
    // recording in progress for the stop channel to find.
    this.sox = sox
    this.filepath = filepath

    // Debug sox output:
    // this.sox?.stdout?.on('data', (chunk) => console.log(chunk.toString()))
    // this.sox?.stderr?.on('data', (chunk) => console.error(chunk.toString()))
  }

  /** Stops the recording and returns the file it wrote. */
  public async stop(): Promise<string> {
    const sox = this.sox
    const filepath = this.filepath
    if (!sox || !filepath) {
      throw new Error('No recording is in progress')
    }

    // SIGINT, not SIGQUIT. sox only seeks back to patch the WAV header with the
    // real data-chunk size when it shuts down cleanly. Killed with SIGQUIT it
    // leaves the 0x7FFFF800 placeholder in place, and every recording then
    // reports the same bogus multi-hour duration to players.
    await new Promise<void>((resolve) => {
      const giveUp = setTimeout(() => {
        // sox ignored the interrupt. Waiting longer would leave the renderer
        // holding a promise that never settles, so take the file with the bad
        // header over no answer at all.
        console.warn('sox did not exit on SIGINT; killing it')
        sox.kill('SIGKILL')
      }, STOP_TIMEOUT_MS)

      sox.once('close', () => {
        clearTimeout(giveUp)
        resolve()
      })
      sox.kill('SIGINT')
    })

    this.sox = null
    this.filepath = null
    return filepath
  }
}
