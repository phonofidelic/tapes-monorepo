import { dialog } from 'electron'
import { IpcChannel, ValidIpcChanel } from '@tapes-monorepo/core'

export class OpenDirectoryDialogChannel implements IpcChannel {
  name: ValidIpcChanel = 'storage:open-directory-dialog'
  async handle() {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
      })
      // A cancelled dialog is not a failure, and not a chosen path either. The
      // caller keeps the location it already had.
      return result.canceled ? '__unset__' : result.filePaths[0]
    } catch {
      return undefined
    }
  }
}
