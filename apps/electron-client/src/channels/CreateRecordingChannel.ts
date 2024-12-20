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

    /**
     * SoX: The Swiss Army knife of sound processing
     *
     * * Wikipedia: https://en.wikipedia.org/wiki/SoX
     * * Manual: https://explainshell.com/explain/1/sox
     * * Download: https://sourceforge.net/projects/sox
     */
    const soxPath =
      process.env.NODE_ENV !== 'development'
        ? path.resolve(process.resourcesPath, 'sox-14.4.2-macOS')
        : path.resolve(appPath, 'bin', 'sox-14.4.2-macOS')

    this.filepath = path.resolve(
      data.storageLocation,
      `${crypto.randomUUID()}.${data.audioFormat}`,
    )

    try {
      this.sox = execFile(soxPath, [
        '--default-device',
        '--no-show-progress',
        `--type=${data.audioFormat}`,
        `--channels=${data.audioChannelCount}`,
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
  audioChannelCount: number
  audioFormat: 'mp3' | 'wav' | 'ogg' | 'flac'
} => {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('storageLocation' in data) ||
    typeof data.storageLocation !== 'string' ||
    !('audioChannelCount' in data) ||
    typeof data.audioChannelCount !== 'number' ||
    data.audioChannelCount < 1 ||
    data.audioChannelCount > 2 ||
    !('audioFormat' in data) ||
    typeof data.audioFormat !== 'string' ||
    !['mp3', 'wav', 'ogg', 'flac'].includes(data.audioFormat)
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
