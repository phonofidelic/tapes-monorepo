import path from 'path'
import { promisify } from 'util'
import child_process from 'node:child_process'
import { app } from 'electron'
import {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

const execFile = promisify(child_process.execFile)

export class SetDefaultAudioInputChannel implements IpcChannel {
  name: ValidIpcChanel = 'settings:set-default-audio-input-device'

  async handle(request: IpcRequest): Promise<IpcResponse> {
    const { data } = request
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
        ? path.resolve(process.resourcesPath, 'SwitchAudioSource-1.2.2-macOS')
        : path.resolve(appPath, 'bin', 'SwitchAudioSource-1.2.2-macOS')

    try {
      await execFile(switchAudioSourcePath, [
        '-t',
        'input',
        '-s',
        normalizedDeviceName,
      ])
    } catch (error) {
      console.error(error)
      return {
        success: false,
        error: new Error(
          `Error setting default audio input with deviceName: ${data.deviceName}`,
        ),
      }
    }

    return { success: true }
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
