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

// Current Discord RPC client and state
let rpc = null;
let currentClientId = null;
let isConnecting = false;

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

// Discord RPC connection state
let discordConnected = false;
let lastUpdateTime = null;
let isCleared = false; // Track if we've already cleared for null state
const UPDATE_TIMEOUT = 60000; // 1 minute - clear activity if no updates received
let updateCheckInterval = null;


/**
 * Connect to Discord RPC with a specific CLIENT_ID
 * @param {string} clientId - Discord Application CLIENT_ID
 * @returns {Promise<void>}
 */
async function connectToDiscord(clientId) {
  return new Promise((resolve, reject) => {
    // If already connected with this CLIENT_ID, no need to reconnect
    if (discordConnected && currentClientId === clientId && rpc) {
      resolve();
      return;
    }

    // If connecting, wait a bit
    if (isConnecting) {
      setTimeout(() => connectToDiscord(clientId).then(resolve).catch(reject), 500);
      return;
    }

    isConnecting = true;

    // Disconnect existing connection if any
    if (rpc) {
      try {
        rpc.destroy().catch(() => {});
      } catch (e) {
        // Ignore errors during cleanup
      }
      rpc = null;
      discordConnected = false;
    }

    // Create new RPC client
    rpc = new RPC.Client({ transport: 'ipc' });

    // Set up ready handler
    rpc.once('ready', () => {
      discordConnected = true;
      currentClientId = clientId;
      isConnecting = false;
      console.log(`✅ Connected to Discord! (CLIENT_ID: ${clientId})`);
      
      // Start checking for stale updates (mobile app disconnected)
      startUpdateCheck();
      resolve();
    });

    // Handle errors
    rpc.once('error', (err) => {
      isConnecting = false;
      reject(err);
    });

    // Login
    rpc.login({ clientId }).catch(err => {
      isConnecting = false;
      reject(err);
    });
  });
}

// Don't connect on startup - wait for first update with CLIENT_ID

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

  rpc.setActivity(testActivity).then(() => {
    res.json({ success: true, message: 'Test activity set' });
  }).catch((error) => {
    res.status(500).json({ error: error.message });
  });
});

// API endpoint to update Rich Presence
app.post('/update-presence', async (req, res) => {
  const { appName, packageName, displayName, clientId } = req.body;

  // Update last received time - this resets the timeout
  lastUpdateTime = Date.now();
  console.log(`📥 Update received at ${new Date().toLocaleTimeString()}`);

  // Skip if app is null or unknown
  if (!displayName || displayName === 'null' || packageName === 'unknown' || packageName === 'null') {
    // Only clear once when transitioning to null, then just wait
    if (!isCleared && rpc && discordConnected) {
      rpc.clearActivity().catch(() => {});
      isCleared = true;
    }
    lastUpdateTime = null; // Reset so checker doesn't keep clearing
    return res.json({ success: true, message: 'Cleared activity' });
  }
  
  // Reset cleared flag when we get a valid app
  isCleared = false;

  // CLIENT_ID is required - must be set in mobile app dialog
  if (!clientId || !clientId.trim()) {
    return res.json({ success: false, message: 'CLIENT_ID required. Set it in the app settings dialog.' });
  }

  const requiredClientId = clientId.trim();
  
  // Check if we need to switch CLIENT_IDs
  if (currentClientId !== requiredClientId || !discordConnected || !rpc) {
    try {
      await connectToDiscord(requiredClientId);
    } catch (error) {
      return res.status(503).json({ error: 'Failed to connect to Discord', details: error.message });
    }
  }

  if (!discordConnected || !rpc) {
    return res.status(503).json({ error: 'Discord not connected' });
  }

  // Update Discord Rich Presence immediately when we receive an update
  // Note: Timestamps must be in seconds (not milliseconds)
  // IMPORTANT: The discord-rpc library does NOT support a 'name' field.
  // The application name (from CLIENT_ID) will always show as the main title.
  // Each package can have its own CLIENT_ID with custom name/icon in Discord Developer Portal.
  const activity = {
    details: displayName, // Custom name or package name - only show custom name in details
    startTimestamp: Math.floor(Date.now() / 1000), // Convert to seconds
    instance: false,
  };

  rpc.setActivity(activity).then(() => {
    console.log(`✅ Successfully updated: ${displayName} (${packageName}) [CLIENT_ID: ${requiredClientId}]`);
    res.json({ success: true, message: 'Presence updated' });
  }).catch((error) => {
    console.error('❌ Error updating presence:', error);
    res.status(500).json({ error: error.message });
  });
});

// API endpoint to clear Rich Presence
app.post('/clear-presence', (req, res) => {
  if (!discordConnected) {
    return res.status(503).json({ error: 'Discord not connected' });
  }

  // Only clear once, then just wait
  if (!isCleared) {
    lastUpdateTime = null;
    isCleared = true;

    rpc.clearActivity().then(() => {
      res.json({ success: true, message: 'Presence cleared' });
    }).catch((error) => {
      res.status(500).json({ error: error.message });
    });
  } else {
    res.json({ success: true, message: 'Already cleared' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    discordConnected,
    currentClientId: currentClientId || null,
    ip: localIP,
    port: PORT
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`📡 Server: http://${localIP}:${PORT}`);
});

// Function to check if mobile app is still sending updates
function startUpdateCheck() {
  // Clear any existing interval
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
  }
  
  // Check every 30 seconds to catch stale updates
  updateCheckInterval = setInterval(() => {
    if (!discordConnected) {
      return;
    }
    
    // If we've never received an update, don't clear
    if (lastUpdateTime === null) {
      return;
    }
    
    // If no update received in 60 seconds, clear activity
    const timeSinceLastUpdate = Date.now() - lastUpdateTime;
    const secondsSinceUpdate = Math.floor(timeSinceLastUpdate / 1000);
    
    if (timeSinceLastUpdate >= UPDATE_TIMEOUT) {
      // Only clear once if we haven't already
      if (!isCleared) {
        rpc.clearActivity().then(() => {
          isCleared = true;
          lastUpdateTime = null; // Reset so we don't keep clearing
        }).catch(() => {});
      }
    }
  }, 30000); // Check every 30 seconds
}

// Graceful shutdown
process.on('SIGINT', () => {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
  }
  if (rpc) {
    rpc.destroy().catch(() => {});
  }
  process.exit(0);
});

