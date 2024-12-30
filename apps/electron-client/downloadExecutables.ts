import { createWriteStream } from 'fs'
import { open, mkdir, rm, chmod, cp } from 'fs/promises'
import { Readable } from 'stream'
import { finished } from 'stream/promises'
import { execSync } from 'child_process'
const StreamZip = require('node-stream-zip')

async function main() {
  const tmpDir = await getDir('tmp')

  const soxUrl =
    'https://downloads.sourceforge.net/project/sox/sox/14.4.2/sox-14.4.2-macosx.zip'
  await downloadFile(soxUrl, 'tmp/sox.zip')
  const soxZip = new StreamZip.async({ file: 'tmp/sox.zip' })
  await soxZip.extract(null, 'tmp/sox')
  soxZip.close()
  await cp('tmp/sox/sox-14.4.2/sox', 'bin/sox-14.4.2-macOS', { force: true })
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

async function downloadFile(url: string, destination: string) {
  const response = await fetch(url)
  const fileStream = createWriteStream(destination, { flags: 'wx' })

  if (!response || !response.body) {
    throw new Error('No body in response')
  }

  // @ts-ignore
  await finished(Readable.fromWeb(response.body).pipe(fileStream))
}
