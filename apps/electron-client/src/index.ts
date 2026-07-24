import { CreateRecordingChannel } from './channels/CreateRecordingChannel'
import { DeleteRecordingChannel } from './channels/DeleteRecordingChannel'
import { EditRecordingChannel } from './channels/EditRecordingChannel'
import { GetSyncServerInfoChannel } from './channels/GetSyncServerInfoChannel'
import { OpenDirectoryDialogChannel } from './channels/OpenDirectoryDialogChannel'
import { ReadFileChannel } from './channels/ReadFileChannel'
import { SetDefaultAudioInputChannel } from './channels/SetDefaultAudioInputChannel'
import { SetSyncServerLanChannel } from './channels/SetSyncServerLanChannel'
import { SetSyncServerHttpsChannel } from './channels/SetSyncServerHttpsChannel'
import { MainWindow } from './main'

new MainWindow().init([
  new OpenDirectoryDialogChannel(),
  new CreateRecordingChannel(),
  new EditRecordingChannel(),
  new DeleteRecordingChannel(),
  new ReadFileChannel(),
  new SetDefaultAudioInputChannel(),
  new GetSyncServerInfoChannel(),
  new SetSyncServerLanChannel(),
  new SetSyncServerHttpsChannel(),
])
