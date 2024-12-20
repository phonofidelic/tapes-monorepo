import path from 'path'
import crypto from 'crypto'
import { execFile, ChildProcess } from 'child_process'
import { ipcMain, app, IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'

export class CreateRecordingChannel implements IpcChannel {
  name = 'recorder:start'

  private filepath: string | null = null
  private sox: ChildProcess | null = null

  handle(event: IpcMainEvent, request: IpcRequest) {
    const { responseChannel, data } = request
    if (!responseChannel) {
      throw new Error(`No response channel provided for ${this.name} request`)
    }

    if (!isValidStartRecordingRequestData(data)) {
      throw new Error(`Invalid data provided for ${this.name} request`)
    }

    ipcMain.once('recorder:stop', this.onRecorderStop.bind(this))

    const appPath = app.getAppPath()

    const soxPath =
      process.env.NODE_ENV !== 'development'
        ? path.resolve(process.resourcesPath, 'sox-14.4.2-macOS')
        : path.resolve(appPath, 'bin', 'sox-14.4.2-macOS')

    this.filepath = path.resolve(
      data.storageLocation,
      `${crypto.randomUUID()}.wav`,
    )

    try {
      this.sox = execFile(soxPath, [
        '--default-device',
        // `-t coreaudio "${recordingSettings.selectedMediaDeviceId}"`,
        '--no-show-progress',
        // `-c${recordingSettings.channels}`,
        // `-t${recordingSettings.format}`,
        `--channels=2`,
        `--type=wav`,
        this.filepath,
      ])

      if (!this.sox.stdout || !this.sox.stderr) {
        throw new Error('Failed to start sox process')
      }
    } catch (error) {
      console.error(error)
    }

    event.sender.send(responseChannel, {
      data: {
        debug: `env: ${process.env.NODE_ENV} \nsoxPath: ${soxPath} \nprocess.resourcesPath: ${process.resourcesPath} \nappPath: ${appPath}`,
      },
      success: true,
    })
  }

  private async onRecorderStop(event: IpcMainEvent, request: IpcRequest) {
    if (!request.responseChannel) {
      throw new Error(`No response channel provided for recorder:stop request`)
    }

    if (!isValidStopRecordingRequestData(request.data)) {
      throw new Error(`Invalid data provided for recorder:stop request`)
    }

    if (!this.filepath) {
      throw new Error(`No filepath provided for recorder:stop request`)
    }

    if (!this.sox) {
      throw new Error(`No sox process provided for recorder:stop request`)
    }

    try {
      this.sox.kill('SIGQUIT')
    } catch (error) {
      console.error(error)
      event.sender.send(request.responseChannel, {
        error: new Error('Could not end sox process'),
        success: false,
      })
      return
    }

    event.sender.send(request.responseChannel, {
      data: { filepath: this.filepath },
      success: true,
    })
  }
}

const isValidStartRecordingRequestData = (
  data: unknown,
): data is {
  storageLocation: string
} => {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('storageLocation' in data) ||
    typeof data.storageLocation !== 'string'
  ) {
    return false
  }
  return true
}

const isValidStopRecordingRequestData = (
  data: unknown,
): data is {
  storageLocation: string
  duration: number
} => {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('storageLocation' in data) ||
    typeof data.storageLocation !== 'string' ||
    !('duration' in data) ||
    typeof data.duration !== 'number'
  ) {
    return false
  }
  return true
}
