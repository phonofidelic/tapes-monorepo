/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCAL_NETWORK_IP: string
  readonly VITE_LOCAL_NETWORK_PROTOCOL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
