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
      // `exact` matters: a bare `deviceId` is only an *ideal* hint, and
      // Chromium ignores it — it hands back the system default microphone no
      // matter which device was selected, so the app silently recorded from
      // the wrong input. Fall back to `true` (the default device) when no
      // device has been chosen yet, rather than sending an empty constraint.
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
 * The document url lives in `localStorage` rather than in React state because
 * the shells read it while building their repo, above the tree that writes it
 * — the same seam as `subscribeToSettingsChange` in `SettingsContext`. Storage
 * on its own doesn't re-render anything though, so a write is published here
 * too: importing a host's url used to change nothing on screen until the next
 * launch, because every reader re-read storage during render and nothing ever
 * told them to render again.
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

  // `am` is a bootstrap seed a pairing link drops in, and `readAutomergeUrl`
  // lets it win over storage — so a guest opened from a QR code would keep
  // resolving to the host's original document and this write would be
  // invisible. Once a url has been chosen explicitly the seed has served its
  // purpose: drop it, as the shell already does with the `pt` token.
  const location = new URL(window.location.href)
  if (location.searchParams.has('am')) {
    location.searchParams.delete('am')
    window.history.replaceState({}, '', location)
  }

  // Iterate a copy: a listener that unsubscribes in response would otherwise
  // mutate the set mid-iteration.
  for (const listener of [...automergeUrlListeners]) {
    try {
      listener()
    } catch (error) {
      console.error('An automergeUrl listener threw', error)
    }
  }
}

export function useAutomergeUrl() {
  const automergeUrl = useSyncExternalStore(
    subscribeToAutomergeUrl,
    readAutomergeUrl,
    readAutomergeUrl,
  )

  return { automergeUrl, setAutomergeUrl }
}
