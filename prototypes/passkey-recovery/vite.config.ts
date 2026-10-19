/**
 * THROWAWAY PROTOTYPE (TAP-217). Not production code.
 *
 * Serves the guest page and the host page, plus the stand-in host API. TLS
 * normally comes from a tunnel in front of this server. Set PROTO_TLS_CERT and
 * PROTO_TLS_KEY to serve HTTPS directly for a real subdomain on the LAN.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import { protoHost } from './hostPlugin'

const cert = process.env.PROTO_TLS_CERT
const key = process.env.PROTO_TLS_KEY

export default defineConfig({
  root: __dirname,
  plugins: [protoHost(path.join(__dirname, '.data'))],
  server: {
    host: true,
    port: Number(process.env.PROTO_PORT ?? 5190),
    strictPort: true,
    // Tunnel and subdomain hostnames are not known ahead of time.
    allowedHosts: true,
    https:
      cert && key
        ? { cert: readFileSync(cert), key: readFileSync(key) }
        : undefined,
    // Off by default. Behind a tunnel the HMR socket asks for the dev port
    // and fails on the phone.
    hmr: process.env.PROTO_HMR ? undefined : false,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        guest: path.resolve(__dirname, 'index.html'),
        host: path.resolve(__dirname, 'host.html'),
      },
    },
  },
})
