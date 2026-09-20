---
'electron-client': patch
---

Recording on the desktop app now reports a start that never happened, and always answers a stop.

A sox process that fails to launch is reported on its error event rather than by throwing, so a missing binary used to look like a successful start. The app began its timer over a recorder that was not running, and the user first learned of it when stopping produced no file. Starting now waits for the process to come up and answers with a failure if it does not.

Stopping used to require a storage location and an elapsed time, then read neither. Clearing the storage location mid-recording made every stop invalid, and the request was rejected rather than answered. The app had already left its recording state, so sox kept running with nothing able to reach it.

A sox that ignores the interrupt is now killed after five seconds. It previously left the app waiting for an answer that never came.
