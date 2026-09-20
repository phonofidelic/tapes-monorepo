import path from 'path'
import crypto from 'crypto'
import { execFile, ChildProcess } from 'child_process'
import { app } from 'electron'

const DEFAULT_SAMPLE_RATE = 44100

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

  public start(options: {
    storageLocation: string
    audioChannelCount: number
    audioFormat: 'mp3' | 'wav' | 'ogg' | 'flac'
  }) {
    this.filepath = path.resolve(
      options.storageLocation,
      `${crypto.randomUUID()}.${options.audioFormat}`,
    )

    try {
      this.sox = execFile(this.soxPath, [
        '--default-device',
        '--no-show-progress',
        `--type=${options.audioFormat === 'mp3' ? 'wav' : options.audioFormat}`,
        `--channels=${options.audioChannelCount}`,
        `--rate=${DEFAULT_SAMPLE_RATE}`,
        this.filepath,
      ])

      if (!this.sox.stdout || !this.sox.stderr) {
        throw new Error('Failed to start sox process')
      }
    } catch (error) {
      console.error(error)
    }

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
      sox.once('close', () => resolve())
      sox.kill('SIGINT')
    })

    this.sox = null
    this.filepath = null
    return filepath
  }
}
