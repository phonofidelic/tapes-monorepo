import { spawn } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { APP_ROOT } from './electronApp'

/**
 * Whether this machine can actually capture audio.
 *
 * Recording is the one part of this suite no flag can fake: there is no
 * `--use-fake-device-for-media-capture` for a `sox` subprocess, so the machine
 * needs a real default input. A run without one produces a zero-length WAV and
 * a chain of downstream failures that say nothing about the code, so the specs
 * check this first and skip with a reason instead.
 *
 * This runs `sox` as a child of the *test* process. macOS attributes microphone
 * access to the responsible parent, so a pass here means the terminal has been
 * granted the mic — the packaged app is a separate grant, and the first run
 * against a fresh build may still surface a system prompt.
 */
export async function canCaptureAudio(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  // Twice before giving up. Opening a coreaudio input takes a variable moment,
  // and a probe that lands inside it comes back with a header and almost no
  // samples — measured anywhere from 80 bytes to 98kB for the same 750ms
  // capture. A second attempt finds the device already warm.
  const first = await probeCapture()
  return first.ok ? first : probeCapture()
}

async function probeCapture(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const sox = path.join(APP_ROOT, 'bin', 'sox-14.4.2-macOS')
  const root = await mkdtemp(path.join(os.tmpdir(), 'tapes-e2e-capture-'))
  const target = path.join(root, 'probe.wav')

  try {
    const child = spawn(
      sox,
      [
        '--default-device',
        '--no-show-progress',
        '--type=wav',
        '--channels=1',
        '--rate=44100',
        target,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const exited = new Promise<number | null>((resolve) => {
      child.once('error', () => resolve(null))
      child.once('close', (code) => resolve(code))
    })

    // Long enough for coreaudio to hand over frames reliably — at 750ms the
    // captured size swung by three orders of magnitude between runs, at 1500ms
    // it was steady — and short enough that a machine with no input fails the
    // suite quickly rather than hanging it.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    // SIGINT, as the app does: only a clean shutdown makes sox seek back and
    // patch the WAV header with the real data-chunk size.
    child.kill('SIGINT')
    await exited

    const { size } = await stat(target).catch(() => ({ size: 0 }))
    // A tenth of a second of 44.1kHz mono, well under what 1500ms yields on a
    // working device and well over the 44-byte header of a failed capture.
    if (size < 8820) {
      return {
        ok: false,
        reason: `sox captured nothing from the default input${
          stderr ? `: ${stderr.trim()}` : ''
        }`,
      }
    }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      reason: `sox could not be run: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
