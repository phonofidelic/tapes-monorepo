import { CreateRecordingChannel } from './channels/CreateRecordingChannel'
import { DeleteRecordingChannel } from './channels/DeleteRecordingChannel'
import { EditRecordingChannel } from './channels/EditRecordingChannel'
import { OpenDirectoryDialogChannel } from './channels/OpenDirectoryDialogChannel'
import { SetDefaultAudioInputChannel } from './channels/SetDefaultAudioInputChannel'
import { MainWindow } from './main'

new MainWindow().init([
  new OpenDirectoryDialogChannel(),
  new CreateRecordingChannel(),
  new EditRecordingChannel(),
  new DeleteRecordingChannel(),
  new SetDefaultAudioInputChannel(),
])
