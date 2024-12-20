import path from 'path'
import { promisify } from 'util'
import child_process from 'node:child_process'
import { app, IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'

const execFile = promisify(child_process.execFile)

export class SetDefaultAudioInputChannel implements IpcChannel {
  name = 'settings:set-default-audio-input-device'

  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { responseChannel, data } = request
    if (!responseChannel) {
      throw new Error(`No response channel provided for ${this.name} request`)
    }

    if (!isValidSetDefaultAudioInputRequestData(data)) {
      throw new Error(`Invalid data provided for ${this.name} request`)
    }

    const appPath = app.getAppPath()

    const normalizedDeviceName = /internal/i.test(data.deviceName)
      ? 'internal'
      : // Matches code that appears in parenthesis after device name.
        // eg: "VIDBOX NW07 (eb1a:5188)"
        // results in "VIDBOX NW07"
        data.deviceName.replace(/ *\([^)]*\)$ */g, '').trim()

    /**
     * switchaudio-osx
     *
     * * GitHub: https://github.com/deweller/switchaudio-osx
     */
    const switchAudioSourcePath =
      process.env.NODE_ENV !== 'development'
        ? path.resolve(process.resourcesPath, 'SwitchAudioSource')
        : path.resolve(appPath, 'bin', 'SwitchAudioSource')

    try {
      await execFile(switchAudioSourcePath, [
        '-t',
        'input',
        '-s',
        normalizedDeviceName,
      ])
    } catch (error) {
      console.error(error)
      event.sender.send(responseChannel, {
        error: {
          message: new Error(
            `Error setting default audio input with deviceName: ${data.deviceName}`,
          ),
        },
        success: false,
      })
      return
    }

    event.sender.send(responseChannel, {
      success: true,
    })
  }
}

const isValidSetDefaultAudioInputRequestData = (
  data: unknown,
): data is { deviceName: string } => {
  return (
    typeof data === 'object' &&
    data !== null &&
    'deviceName' in data &&
    typeof data.deviceName === 'string' &&
    data.deviceName.length > 0
  )
}
