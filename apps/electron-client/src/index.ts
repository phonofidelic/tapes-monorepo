import { OpenDirectoryDialogChannel } from './channels/OpenDirectoryDialogChannel'
import { MainWindow } from './main'

new MainWindow().init([new OpenDirectoryDialogChannel()])
