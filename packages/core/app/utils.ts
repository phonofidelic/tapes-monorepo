export const getAudioStream = async (selectedMediaDeviceId: string) => {
  let audioStream
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: selectedMediaDeviceId },
      video: false,
    })
  } catch (error) {
    console.error(error)
    throw new Error('Could not get media stream')
  }
  return audioStream
}

export function useAutomergeUrl() {
  const automergeUrl =
    new URLSearchParams(window.location.search).get('am') ??
    localStorage.getItem('automergeUrl')

  const setAutomergeUrl = (url: string) => {
    localStorage.setItem('automergeUrl', url)
  }

  return { automergeUrl, setAutomergeUrl }
}
