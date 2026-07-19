export {}

export type RecorderConstruction = {
  trackDeviceId: string | undefined
  trackLabel: string
}

export type E2EState = {
  mediaRecorderCount: number
  constructions: RecorderConstruction[]
  gumConstraints: MediaStreamConstraints[]
  workerMessageListenerAdds: number
  workerMessageListenerRemoves: number
}

declare global {
  interface Window {
    __tapesE2E: E2EState
    // Set by @vitejs/plugin-react's refresh preamble, which only runs on the
    // dev server. Used to prove StrictMode is actually active.
    __vite_plugin_react_preamble_installed__?: boolean
  }
}
