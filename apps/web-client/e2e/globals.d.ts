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
    // Set by the synthetic beforeinstallprompt in install.spec.ts, so a test
    // can tell that the Install button reached event.prompt().
    __installPromptCalled?: boolean
    // Every element `new Audio()` has made, newest last. streaming.spec.ts
    // patches the constructor to collect them: the player never puts its
    // element in the document, so there is no other way to reach one.
    __tapesAudio: HTMLAudioElement[]
    // Set by @vitejs/plugin-react's refresh preamble, which only runs on the
    // dev server. Used to prove StrictMode is actually active.
    __vite_plugin_react_preamble_installed__?: boolean
  }
}
