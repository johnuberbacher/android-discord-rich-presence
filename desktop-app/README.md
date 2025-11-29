# Discord Rich Presence Desktop Companion

Desktop companion app that receives app data from your Android app and updates Discord Rich Presence using the official Discord SDK.

## Setup

### 1. Get Discord Application ID

1. Go to https://discord.com/developers/applications
2. Create a new application (or use existing)
3. Copy the **Application ID**
4. Open `index.js` and replace `YOUR_DISCORD_APPLICATION_ID` with your ID

### 2. Install Dependencies

```bash
npm install
```

### 3. Run the App

```bash
npm start
```

### 4. Connect Mobile App

1. Note the IP address shown (e.g., `192.168.1.100:8080`)
2. Open your mobile app
3. Enter this IP address in the settings
4. Make sure both devices are on the same WiFi network

## Requirements

- Node.js installed
- Discord desktop app running
- Both devices on same WiFi network

## Troubleshooting

**"Failed to connect to Discord"**
- Make sure Discord desktop app is running
- Check that CLIENT_ID is set correctly
- Ensure your Discord app has Rich Presence enabled in Developer Portal

**"Cannot connect to desktop app"**
- Make sure both devices are on the same WiFi network
- Check firewall isn't blocking port 8080
- Verify the IP address is correct

## Security Note

This app runs a local HTTP server on your network. Only devices on your local network can access it.

