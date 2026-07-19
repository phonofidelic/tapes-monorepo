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

export function setAutomergeUrl(url: string) {
  localStorage.setItem('automergeUrl', url)
}

export function useAutomergeUrl() {
  const automergeUrl =
    new URLSearchParams(window.location.search).get('am') ??
    localStorage.getItem('automergeUrl')

  return { automergeUrl, setAutomergeUrl }
}
