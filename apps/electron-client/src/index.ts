import { CreateRecordingChannel } from './channels/CreateRecordingChannel'
import { OpenDirectoryDialogChannel } from './channels/OpenDirectoryDialogChannel'
import { MainWindow } from './main'

new MainWindow().init([
  new OpenDirectoryDialogChannel(),
  new CreateRecordingChannel(),
])
