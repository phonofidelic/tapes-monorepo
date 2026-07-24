import { execSync } from 'node:child_process'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerRpm } from '@electron-forge/maker-rpm'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'

const notarizeOptions = {
  appleId: process.env.APPLE_ID ?? '',
  appleIdPassword: process.env.APPLE_PASSWORD ?? '',
  teamId: process.env.APPLE_TEAM_ID ?? '',
} as const

// Notarization requires a real "Developer ID Application" certificate: Apple
// rejects the ad-hoc signature that `osxSign: {}` falls back to when no cert is
// installed. Detect a usable identity so local `yarn package` runs produce an
// ad-hoc-signed build and skip notarization, while CI/release machines that
// have imported a Developer ID cert (and set the APPLE_* creds) still notarize.
function hasDeveloperIdCertificate(): boolean {
  try {
    const identities = execSync('security find-identity -v -p codesigning', {
      encoding: 'utf8',
    })
    return identities.includes('Developer ID Application')
  } catch {
    return false
  }
}

const canNotarize =
  hasDeveloperIdCertificate() &&
  Boolean(
    process.env.APPLE_ID &&
      process.env.APPLE_PASSWORD &&
      process.env.APPLE_TEAM_ID,
  )

const repositoryOptions = {
  owner: process.env.REPO_OWNER ?? '',
  name: process.env.REPO_NAME ?? '',
} as const

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    osxSign: {},
    ...(canNotarize ? { osxNotarize: notarizeOptions } : {}),
    extraResource: [
      'bin/sox-14.4.2-macOS',
      'bin/SwitchAudioSource-1.2.2-macOS',
      'cache',
      // Built web-client bundle, staged by the `stage-web-client` script and
      // served to LAN guests by the embedded sync server (see syncServer.ts).
      'web-client',
    ],
  },
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: repositoryOptions,
        prerelease: true,
        draft: true,
      },
    },
  ],
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
    new MakerDMG(),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
}

export default config
