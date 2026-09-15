import { isValidAutomergeUrl } from '@automerge/automerge-repo'
import { useSyncExternalStore } from 'react'

/** The selected input device exists in settings but is no longer available. */
export class AudioInputUnavailableError extends Error {
  constructor(deviceId: string) {
    super(`Selected audio input device is unavailable: ${deviceId}`)
    this.name = 'AudioInputUnavailableError'
  }
}

const isOverconstrained = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  (error as { name: unknown }).name === 'OverconstrainedError'

export const getAudioStream = async (selectedMediaDeviceId: string) => {
  try {
    return await navigator.mediaDevices.getUserMedia({
      // `exact` matters. A bare device id is only an ideal hint, and Chromium
      // ignores it and returns the system default microphone. The app then
      // records from the wrong input. When no device has been chosen yet,
      // pass `true` for the default device rather than an empty constraint.
      audio: selectedMediaDeviceId
        ? { deviceId: { exact: selectedMediaDeviceId } }
        : true,
      video: false,
    })
  } catch (error) {
    console.error(error)
    // With `exact`, a stored-but-missing device now rejects instead of quietly
    // falling back. Surface that as its own error so callers can prompt for a
    // different input rather than reporting a generic failure.
    if (isOverconstrained(error)) {
      throw new AudioInputUnavailableError(selectedMediaDeviceId)
    }
    throw new Error('Could not get media stream')
  }
}

const AUTOMERGE_URL_KEY = 'automergeUrl'

/**
 * The document url lives in `localStorage` rather than React state, because
 * the shells read it while building their repo, above the tree that writes
 * it. This is the same seam as the settings change subscription. Storage on
 * its own re-renders nothing, so every write is also published to these
 * listeners.
 */
const automergeUrlListeners = new Set<() => void>()

function subscribeToAutomergeUrl(listener: () => void) {
  automergeUrlListeners.add(listener)
  return () => {
    automergeUrlListeners.delete(listener)
  }
}

function readAutomergeUrl() {
  return (
    new URLSearchParams(window.location.search).get('am') ??
    localStorage.getItem(AUTOMERGE_URL_KEY)
  )
}

export function setAutomergeUrl(url: string) {
  localStorage.setItem(AUTOMERGE_URL_KEY, url)

  // `am` is a bootstrap seed that a pairing link adds, and it wins over
  // storage when the url is read. Without this a guest opened from a QR code
  // would keep resolving to the host's original document, and this write
  // would be invisible. Once a url has been chosen the seed has done its job.
  // The shell drops the `pt` token the same way.
  const location = new URL(window.location.href)
  if (location.searchParams.has('am')) {
    location.searchParams.delete('am')
    window.history.replaceState({}, '', location)
  }

  // Readers re-read storage during render, so without this an imported host
  // url would not show until the next launch. Iterate a copy: a listener that
  // unsubscribes in response would otherwise mutate the set mid-iteration.
  for (const listener of [...automergeUrlListeners]) {
    try {
      listener()
    } catch (error) {
      console.error('An automergeUrl listener threw', error)
    }
  }
}

export function useAutomergeUrl() {
  const storedUrl = useSyncExternalStore(
    subscribeToAutomergeUrl,
    readAutomergeUrl,
    readAutomergeUrl,
  )

  // A missing url is normal: a fresh client has not created its document yet,
  // and a guest opens Settings with nothing stored to paste a host url in. A
  // stored value that is not an automerge url is not normal, and silently
  // treating it as missing would overwrite whatever the user pasted wrong.
  if (storedUrl !== null && !isValidAutomergeUrl(storedUrl)) {
    throw new Error('Invalid automerge URL')
  }

  return { automergeUrl: storedUrl, setAutomergeUrl }
}

/**
 * For the views that read the document itself. They render below the shell's
 * repo, which exists only once a url has been stored, so a missing url here
 * is a bug rather than a state to render around.
 */
export function useRequiredAutomergeUrl() {
  const { automergeUrl, setAutomergeUrl } = useAutomergeUrl()

  if (automergeUrl === null) {
    throw new Error('No automerge URL')
  }

  return { automergeUrl, setAutomergeUrl }
}
