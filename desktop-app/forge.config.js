const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    name: 'Android Discord Rich Presence Companion',
    executableName: 'Android Discord Rich Presence Companion',
    icon: './icon', // Path without extension - Forge will add .ico for Windows
    asar: true,
    appBundleId: 'com.discordrpc.desktop',
    appCopyright: 'Copyright © 2025 John Uberbacher',
    win32metadata: {
      CompanyName: 'John Uberbacher',
      FileDescription: 'Desktop companion app for Android Discord Rich Presence',
      ProductName: 'Android Discord Rich Presence Companion',
    },
    // Include extra files for tray icons
    extraResource: [
      './icon.ico',
      './icon.png',
      './tray-icon.ico',
      './tray-icon.png',
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'AndroidDiscordRichPresenceCompanion',
        setupIcon: './icon.ico',
        authors: 'John Uberbacher',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

