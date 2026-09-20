---
'@tapes-monorepo/core': patch
---

A stop pressed while the microphone is still opening is no longer dropped. Opening an input device is asynchronous and has been measured at several seconds on a machine with many inputs. The stop handler ran before the recorder existed, logged "mediaRecorderRef.current is null" and returned, which left the microphone open and the file the worker had created empty. The start path now records that a stop is pending and stops the recorder as soon as it has one.

The start path also releases the audio stream if the recorder cannot be constructed. That failure used to reject inside an event listener, leaving the microphone open with the UI stuck in the recording state.
