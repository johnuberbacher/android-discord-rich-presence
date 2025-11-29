# Android Discord Rich Presence

Display what you're doing on your Android device as Discord Rich Presence status. This app tracks the foreground application on your device and updates your Discord status in real-time through a desktop companion app.

**Note:** This project was developed with the assistance of AI-powered coding tools.

## What It Does

Android Discord Rich Presence monitors which apps you're currently using on your Android device and displays that information as your Discord status. It works by:

- Tracking the foreground application using Android's UsageStats API
- Sending app information to a desktop companion app via your local network
- Updating Discord Rich Presence through the official Discord SDK

## Discord ToS Compliance

**This implementation is fully compliant with Discord's Terms of Service.**

This project uses a **desktop companion app** that connects to Discord using the official `discord-rpc` SDK. This approach is safe and compliant because:

- ✅ Uses the **official Discord RPC SDK** (`discord-rpc`) which is the supported method for Rich Presence
- ✅ Runs on desktop where Discord's RPC API is intended to be used
- ✅ The mobile app only communicates with your local desktop app, not directly with Discord
- ✅ No violation of Discord's API Terms of Service

### Alternative Approach (Not Used)

An alternative approach would be to use Discord's Gateway WebSocket API directly from the mobile app. However, this method:

- ⚠️ **Violates Discord's Terms of Service** - The Gateway API is intended for Discord clients, not third-party applications
- ⚠️ **Risky** - Could result in account suspension or termination
- ⚠️ **Unstable** - Discord may change or restrict Gateway access without notice

**The recommended and safe method is using the desktop companion app with the official Discord RPC SDK.**

## Features

- **Real-time app tracking** - Automatically detects and tracks foreground applications
- **Custom app names** - Set custom display names for any app
- **Per-app Discord Client IDs** - Configure different Discord applications for different mobile apps
- **Enable/disable apps** - Control which apps update your Discord status
- **Desktop companion** - Lightweight Node.js server that handles Discord RPC updates
- **Foreground service** - Continues tracking even when the app is in the background
- **Connection status** - Visual indicators for desktop app connectivity

## Prerequisites

### For Mobile App
- Android device with Android 5.0+ (API 21+)
- React Native development environment
- Node.js and npm
- Android Studio (for building)

### For Desktop App
- Node.js installed
- Discord desktop app running
- Both devices on the same WiFi network

## Installation & Setup

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/android-discord-rich-presence.git
cd android-discord-rich-presence
```

### 2. Install Dependencies

Install dependencies for the main React Native app:

```bash
npm install
```

Install dependencies for the desktop companion app:

```bash
cd desktop-app
npm install
cd ..
```

### 3. Setup Desktop Companion App

1. Get your Discord Application ID:
   - Go to https://discord.com/developers/applications
   - Create a new application (or use an existing one)
   - Copy the **Application ID**

2. Edit `desktop-app/index.js` and replace `YOUR_DISCORD_APPLICATION_ID` with your Application ID (or configure it per-app in the mobile app)

3. Start the desktop app:

```bash
cd desktop-app
npm start
```

4. Note the IP address shown (e.g., `192.168.1.100:8080`)

### 4. Configure Mobile App

1. Open the mobile app on your Android device
2. Grant the required permissions:
   - Usage Access (for tracking foreground apps)
   - Notifications (for foreground service)
3. In the app settings, enter the desktop app IP address (from step 3.4)
4. Enable the desktop connection

## Building the Apps

### Building Android App

#### Development Build

```bash
# Start Metro bundler
npm start

# Build and run on Android (in another terminal)
npm run android
```

#### Production Build (APK)

```bash
cd android
./gradlew assembleRelease
```

The APK will be located at: `android/app/build/outputs/apk/release/app-release.apk`

#### Debug Build

```bash
cd android
./gradlew assembleDebug
```

The debug APK will be at: `android/app/build/outputs/apk/debug/app-debug.apk`

### Building Desktop App

The desktop app runs as a system tray application (Windows). To run it:

```bash
cd desktop-app
npm install
npm start
```

The app will appear in your system tray. Right-click the tray icon to see the server IP address and connection status.

For production, you can build a standalone executable using `electron-builder`:

```bash
npm install -g electron-builder
cd desktop-app
npm run build
```

## Dependencies

### Mobile App (React Native/Expo)

- **expo** (~54.0.25) - React Native framework
- **react** (19.1.0) - React library
- **react-native** (0.81.5) - React Native core
- **@notifee/react-native** (^9.1.8) - Local notifications and foreground services
- **@react-native-async-storage/async-storage** (^2.2.0) - Persistent storage
- **expo-notifications** (^0.32.13) - Notification handling
- **react-native-paper** (^5.14.5) - Material Design components
- **react-native-safe-area-context** (^5.6.2) - Safe area handling

### Desktop App

- **discord-rpc** (^4.0.1) - Discord Rich Presence SDK
- **express** (^4.18.2) - HTTP server framework
- **cors** (^2.8.5) - Cross-origin resource sharing

## Usage

1. **Start the desktop app** on your computer (make sure Discord is running)
2. **Launch the mobile app** on your Android device
3. **Configure apps**:
   - Apps you use will automatically appear in the list
   - Tap an app to configure:
     - Set a custom display name
     - Add a Discord Client ID (get from Discord Developer Portal)
     - Enable/disable the app
4. **Connect to desktop** - Enter your desktop app's IP address in settings
5. **Start using apps** - Your Discord status will update automatically!

## Troubleshooting

### Mobile App Issues

**"Usage Access permission not granted"**
- Go to Android Settings → Apps → Special Access → Usage Access
- Enable access for this app

**"Cannot connect to desktop app"**
- Ensure both devices are on the same WiFi network
- Check that the desktop app is running
- Verify the IP address is correct
- Check firewall settings (port 8080)

**"App not tracking"**
- Make sure the foreground service notification is visible
- Grant all required permissions
- Restart the app

### Desktop App Issues

**"Failed to connect to Discord"**
- Make sure Discord desktop app is running
- Verify CLIENT_ID is set correctly
- Ensure your Discord application has Rich Presence enabled in the Developer Portal

**"Port 8080 already in use"**
- Change the PORT constant in `desktop-app/index.js`
- Update the mobile app with the new port

## Project Structure

```
android-discord-rich-presence/
├── android/              # Android native code
│   └── app/
│       └── src/main/java/com/johnuberbacher/androiddiscordrichpresence/
│           └── ForegroundAppModule.kt  # Native module for app tracking
├── desktop-app/          # Desktop companion app
│   ├── index.js         # Express server and Discord RPC handler
│   └── package.json
├── App.js               # Main React Native app
├── DesktopRPC.js        # Desktop app communication client
└── package.json         # Mobile app dependencies
```

## Security Note

The desktop app runs a local HTTP server on your network. Only devices on your local network can access it. For production use, consider adding authentication.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

