# Discord Rich Presence Desktop Companion

Desktop companion app that runs in the system tray and receives app data from your Android app, updating Discord Rich Presence using the official Discord SDK.

## Features

- 🖥️ **System Tray App** - Runs in the background with no visible window
- 🔌 **Auto-start** - Can be configured to start with Windows
- 📊 **Status Display** - Shows connection status in the tray menu
- 🚀 **Lightweight** - Minimal resource usage

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Run the App

```bash
npm start
```

The app will:
- Start in the system tray (look for the icon in the notification area)
- Run a local HTTP server on port 9090
- Show connection status when you right-click the tray icon

### 3. Connect Mobile App

1. Right-click the tray icon to see the server IP (e.g., `192.168.1.100:9090`)
2. Open your mobile app
3. Enter this IP address in the settings
4. Make sure both devices are on the same WiFi network

**Note:** Discord Application IDs are configured per-app in the mobile app settings, not in this desktop app.

## Requirements

- Node.js installed
- Discord desktop app running
- Both devices on same WiFi network
- Windows (for system tray - can be adapted for macOS/Linux)

## Building for Distribution

To create a standalone executable:

```bash
npm install -g electron-builder
npm run build
```

Or use `pkg` for a simpler Node.js executable:

```bash
npm install -g pkg
pkg main.js --targets node18-win-x64
```

## Auto-start on Windows

To make the app start automatically with Windows:

1. Press `Win + R` and type `shell:startup`
2. Create a shortcut to the app executable in that folder

Or use a tool like `node-windows` to install as a Windows service.

## Troubleshooting

**"Failed to connect to Discord"**
- Make sure Discord desktop app is running
- Check that CLIENT_ID is set correctly in mobile app
- Ensure your Discord app has Rich Presence enabled in Developer Portal

**"Cannot connect to desktop app"**
- Make sure both devices are on the same WiFi network
- Check firewall isn't blocking port 9090
- Verify the IP address is correct
- Right-click tray icon to see current server IP

**"Tray icon not showing"**
- Check the notification area (may be hidden - click the up arrow)
- Restart the app if needed

## Security Note

This app runs a local HTTP server on your network. Only devices on your local network can access it.

