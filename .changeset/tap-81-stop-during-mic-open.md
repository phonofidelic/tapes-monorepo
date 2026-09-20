---
'@tapes-monorepo/core': patch
---

A stop pressed while the microphone is still opening is no longer dropped. The start path records that a stop is pending. It stops the recorder as soon as it has one.

Opening an input device is asynchronous. On a machine with many inputs it has been measured at several seconds. The stop ran before the recorder existed, logged an error and returned. The microphone was left open and the file the worker created was never written.

The start path also releases the audio stream when the recorder cannot be constructed. That failure used to reject with nothing to catch it. The microphone stayed open while the UI still showed a recording in progress.
