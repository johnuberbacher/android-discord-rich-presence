/**
 * Desktop Companion App for Discord Rich Presence
 * 
 * This app runs a local HTTP server that receives app data from the mobile app
 * and updates Discord Rich Presence using the official Discord SDK.
 * 
 * To use:
 * 1. Install dependencies: npm install
 * 2. Get your Discord Application ID from https://discord.com/developers/applications
 * 3. Run: node index.js
 * 4. Note the IP address shown (e.g., 192.168.1.100:8080)
 * 5. Enter this IP in your mobile app
 */

const express = require('express');
const cors = require('cors');
const RPC = require('discord-rpc');
const os = require('os');

const PORT = 8080;
const CLIENT_ID = '1444118921761263747'; 

// Initialize Discord RPC
const rpc = new RPC.Client({ transport: 'ipc' });

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();

// Discord RPC connection
let discordConnected = false;
let lastUpdateTime = null;
const UPDATE_TIMEOUT = 60000; // 1 minute - clear activity if no updates received
let updateCheckInterval = null;

rpc.on('ready', () => {
  discordConnected = true;
  console.log('✅ Connected to Discord!');
  console.log(`📡 Server running at http://${localIP}:${PORT}`);
  console.log(`📱 Enter this IP in your mobile app: ${localIP}:${PORT}`);
  console.log('\n💡 Make sure Discord Activity Privacy is enabled:');
  console.log('   User Settings → Activity Privacy → "Display current activity as a status message"');
  console.log('\n⏳ Waiting for mobile app to send app data...');
  
  // Start checking for stale updates (mobile app disconnected)
  startUpdateCheck();
});

rpc.login({ clientId: CLIENT_ID }).catch(err => {
  console.error('❌ Failed to connect to Discord:', err.message);
  console.log('\n💡 Make sure:');
  console.log('   1. Discord desktop app is running');
  console.log('   2. CLIENT_ID in index.js is set to your Discord Application ID');
  console.log('   3. Your Discord app has Rich Presence enabled');
  process.exit(1);
});

// Test endpoint to manually set Rich Presence
app.post('/test-presence', (req, res) => {
  if (!discordConnected) {
    return res.status(503).json({ error: 'Discord not connected' });
  }

  const testActivity = {
    details: 'Test Rich Presence',
    state: 'Testing connection',
    startTimestamp: Math.floor(Date.now() / 1000),
    instance: false,
  };

  console.log('🧪 Testing activity:', JSON.stringify(testActivity, null, 2));

  rpc.setActivity(testActivity).then(() => {
    console.log('✅ Test activity set successfully');
    res.json({ success: true, message: 'Test activity set' });
  }).catch((error) => {
    console.error('❌ Test activity failed:', error);
    res.status(500).json({ error: error.message });
  });
});

// API endpoint to update Rich Presence
app.post('/update-presence', (req, res) => {
  const { appName, packageName, displayName } = req.body;

  if (!discordConnected) {
    return res.status(503).json({ error: 'Discord not connected' });
  }

  // Update last received time
  lastUpdateTime = Date.now();
  console.log(`📥 Update received at ${new Date().toLocaleTimeString()}`);

  // Skip if app is null or unknown
  if (!displayName || displayName === 'null' || packageName === 'unknown' || packageName === 'null') {
    rpc.clearActivity().catch(console.error);
    return res.json({ success: true, message: 'Cleared activity' });
  }

  // Update Discord Rich Presence
  // Note: Timestamps must be in seconds (not milliseconds)
  const activity = {
    details: `Using ${displayName}`,
    state: packageName,
    startTimestamp: Math.floor(Date.now() / 1000), // Convert to seconds
    instance: false,
  };

  console.log('Setting activity:', JSON.stringify(activity, null, 2));

  rpc.setActivity(activity).then(() => {
    console.log(`✅ Successfully updated: ${displayName} (${packageName})`);
    res.json({ success: true, message: 'Presence updated' });
  }).catch((error) => {
    console.error('❌ Error updating presence:', error);
    console.error('Error details:', error.message, error.stack);
    res.status(500).json({ error: error.message });
  });
});

// API endpoint to clear Rich Presence
app.post('/clear-presence', (req, res) => {
  if (!discordConnected) {
    return res.status(503).json({ error: 'Discord not connected' });
  }

  // Reset last update time so stale checker doesn't keep clearing
  lastUpdateTime = null;
  console.log('📤 Clear request received from mobile app');

  rpc.clearActivity().then(() => {
    console.log('🧹 Cleared Rich Presence');
    res.json({ success: true, message: 'Presence cleared' });
  }).catch((error) => {
    console.error('Error clearing presence:', error);
    res.status(500).json({ error: error.message });
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    discordConnected,
    ip: localIP,
    port: PORT
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n🚀 Desktop Companion App Started');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📡 Server: http://${localIP}:${PORT}`);
  console.log(`📱 Mobile IP: ${localIP}:${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (!discordConnected) {
    console.log('⏳ Connecting to Discord...');
  }
});

// Function to check if mobile app is still sending updates
function startUpdateCheck() {
  // Clear any existing interval
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
  }
  
  console.log('🔄 Started update checker - will check every minute for stale updates');
  
  // Check every 30 seconds (more frequent checks for better responsiveness)
  updateCheckInterval = setInterval(() => {
    if (!discordConnected) {
      return;
    }
    
    // If we've never received an update, don't clear
    if (lastUpdateTime === null) {
      return;
    }
    
    // If no update received in the last minute, clear activity
    const timeSinceLastUpdate = Date.now() - lastUpdateTime;
    const secondsSinceUpdate = Math.floor(timeSinceLastUpdate / 1000);
    
    console.log(`⏱️  Last update: ${secondsSinceUpdate} seconds ago`);
    
    if (timeSinceLastUpdate >= UPDATE_TIMEOUT) {
      console.log(`⏰ No updates received in ${secondsSinceUpdate} seconds - clearing Rich Presence`);
      rpc.clearActivity().then(() => {
        console.log('🧹 Cleared stale Rich Presence');
        lastUpdateTime = null; // Reset so we don't keep clearing
      }).catch((error) => {
        console.error('Error clearing stale presence:', error);
      });
    }
  }, 30000); // Check every 30 seconds (but clear after 60 seconds of no updates)
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
  }
  rpc.destroy();
  process.exit(0);
});

