import { createWriteStream } from 'fs'
import { open, mkdir, rm, chmod, cp, realpath } from 'fs/promises'
import { Readable } from 'stream'
import { finished } from 'stream/promises'
import { execSync } from 'child_process'
import StreamZip from 'node-stream-zip'

async function main() {
  const tmpDir = await getDir('tmp')

  // sox comes from Homebrew, because the SourceForge download is no longer
  // reliable. Homebrew's binary links to other Homebrew libraries by absolute
  // path, so the packaged app only records where Homebrew's sox is installed.
  await cp(await homebrewBinary('sox'), 'bin/sox-14.4.2-macOS', {
    force: true,
  })
  await chmod('bin/sox-14.4.2-macOS', 0o755)

  const switchAudioSourceUrl =
    'https://github.com/deweller/switchaudio-osx/archive/refs/tags/1.2.2.zip'
  await downloadFile(switchAudioSourceUrl, 'tmp/switchaudio-osx-1.2.2.zip')
  const switchAudioSourceZip = new StreamZip.async({
    file: 'tmp/switchaudio-osx-1.2.2.zip',
  })
  await switchAudioSourceZip.extract(
    'switchaudio-osx-1.2.2',
    'tmp/switchaudio-osx',
  )
  execSync('xcodebuild', { cwd: 'tmp/switchaudio-osx' })
  await switchAudioSourceZip.close()
  await cp(
    'tmp/switchaudio-osx/build/Release/SwitchAudioSource',
    'bin/SwitchAudioSource-1.2.2-macOS',
    { force: true },
  )
  await chmod('bin/SwitchAudioSource-1.2.2-macOS', 0o755)

  await tmpDir.close()

  await rm('tmp', { recursive: true, force: true })
}
main()

async function getDir(dirname: string) {
  try {
    return await open(dirname)
  } catch (error) {
    if (error.code === 'ENOENT') {
      await mkdir(dirname)
      return await open(dirname)
    } else {
      throw error
    }
  }
}

/** The path of a Homebrew formula's binary, installing the formula if needed. */
async function homebrewBinary(formula: string) {
  try {
    execSync(`brew list --formula ${formula}`, { stdio: 'ignore' })
  } catch {
    execSync(`brew install ${formula}`, { stdio: 'inherit' })
  }
  const prefix = execSync(`brew --prefix ${formula}`).toString().trim()
  return realpath(`${prefix}/bin/${formula}`)
}

async function downloadFile(url: string, destination: string) {
  const response = await fetch(url)
  const fileStream = createWriteStream(destination, { flags: 'wx' })

  if (!response || !response.body) {
    throw new Error('No body in response')
  }

  // @ts-expect-error the DOM ReadableStream from fetch isn't assignable to
  // Node's stream/web ReadableStream type.
  await finished(Readable.fromWeb(response.body).pipe(fileStream))
}
