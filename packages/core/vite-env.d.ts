/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCAL_NETWORK_IP: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
