import { AnnounceRootDocumentChannel } from './channels/AnnounceRootDocumentChannel'
import { CacheBlobChannel } from './channels/CacheBlobChannel'
import { CreateRecordingChannel } from './channels/CreateRecordingChannel'
import { DeleteRecordingChannel } from './channels/DeleteRecordingChannel'
import { EditRecordingChannel } from './channels/EditRecordingChannel'
import { GetAggregatesChannel } from './channels/GetAggregatesChannel'
import { GetConnectedDevicesChannel } from './channels/GetConnectedDevicesChannel'
import {
  ConfirmVouchChannel,
  GetPendingVouchesChannel,
  RejectVouchChannel,
} from './channels/VouchChannels'
import {
  GetRosterPeopleChannel,
  SetPinChannel,
  UnlockPinChannel,
} from './channels/RosterChannels'
import {
  AddTrustedHostChannel,
  GetTrustedHostsChannel,
  RemoveTrustedHostChannel,
} from './channels/TrustedHostChannels'
import { GetDeviceKeyChannel } from './channels/GetDeviceKeyChannel'
import { GetSyncServerInfoChannel } from './channels/GetSyncServerInfoChannel'
import { HasBlobChannel } from './channels/HasBlobChannel'
import { PutBlobChannel } from './channels/PutBlobChannel'
import { OpenDirectoryDialogChannel } from './channels/OpenDirectoryDialogChannel'
import { ReadFileChannel } from './channels/ReadFileChannel'
import { SetDefaultAudioInputChannel } from './channels/SetDefaultAudioInputChannel'
import { SetSyncServerLanChannel } from './channels/SetSyncServerLanChannel'
import { SetSyncServerHttpsChannel } from './channels/SetSyncServerHttpsChannel'
import { SoxRecorder } from './channels/soxRecorder'
import {
  GetCurrentSessionChannel,
  StartSessionChannel,
  StopSessionChannel,
} from './channels/session'
import { StopRecordingChannel } from './channels/StopRecordingChannel'
import { MainWindow } from './main'

// Recording spans two channels, which share the one running sox process.
const soxRecorder = new SoxRecorder()

new MainWindow().init([
  new OpenDirectoryDialogChannel(),
  new CreateRecordingChannel(soxRecorder),
  new StopRecordingChannel(soxRecorder),
  new EditRecordingChannel(),
  new DeleteRecordingChannel(),
  new ReadFileChannel(),
  new SetDefaultAudioInputChannel(),
  new GetSyncServerInfoChannel(),
  new GetConnectedDevicesChannel(),
  new GetPendingVouchesChannel(),
  new ConfirmVouchChannel(),
  new RejectVouchChannel(),
  new GetRosterPeopleChannel(),
  new UnlockPinChannel(),
  new SetPinChannel(),
  new GetTrustedHostsChannel(),
  new AddTrustedHostChannel(),
  new RemoveTrustedHostChannel(),
  new SetSyncServerLanChannel(),
  new SetSyncServerHttpsChannel(),
  new PutBlobChannel(),
  new HasBlobChannel(),
  new CacheBlobChannel(),
  new AnnounceRootDocumentChannel(),
  new GetAggregatesChannel(),
  new GetDeviceKeyChannel(),
  new StartSessionChannel(),
  new StopSessionChannel(),
  new GetCurrentSessionChannel(),
])
