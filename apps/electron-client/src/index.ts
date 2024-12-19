import { CreateRecordingChannel } from './channels/CreateRecordingChannel'
import { EditRecordingChannel } from './channels/EditRecordingChannel'
import { OpenDirectoryDialogChannel } from './channels/OpenDirectoryDialogChannel'
import { MainWindow } from './main'

new MainWindow().init([
  new OpenDirectoryDialogChannel(),
  new CreateRecordingChannel(),
  new EditRecordingChannel(),
])
