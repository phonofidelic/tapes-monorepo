---
'@tapes-monorepo/core': minor
---

Every reply from the web client's storage worker now carries the request id of the message it answers. Before, only the blob handlers and `storage:get-file` did. A caller had no way to tell which style a given message used, and two reads of different files at once were matched by message type alone, so the first reply satisfied both listeners.

All handlers now reply through the worker's `respond` helper, and all callers go through `callWorker`. Nothing listens to worker messages directly for a request it made. The chunk write during a recording is the one handler that sends no reply, which is deliberate and now says so at the code.

Starting and stopping a web-client recording moved from the Recorder view into `RecordingContext`, which exposes `startRecording` and `stopRecording`. The start filename used to arrive on a broadcast listener; it now comes back as the reply to the start request.
