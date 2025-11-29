/**
 * Express Server (extracted from index.js for Electron)
 * This runs the HTTP server that receives updates from the mobile app
 */

const express = require('express');
const cors = require('cors');
const RPC = require('discord-rpc');
const os = require('os');

const PORT = 9090;

// Current Discord RPC client and state
let rpc = null;
let currentClientId = null;
let isConnecting = false;

// Discord RPC connection state
let discordConnected = false;
let lastUpdateTime = null;
let isCleared = false;
const UPDATE_TIMEOUT = 60000;
let updateCheckInterval = null;

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();

/**
 * Connect to Discord RPC with a specific CLIENT_ID
 */
async function connectToDiscord(clientId) {
  return new Promise((resolve, reject) => {
    if (discordConnected && currentClientId === clientId && rpc) {
      resolve();
      return;
    }

    if (isConnecting) {
      setTimeout(() => connectToDiscord(clientId).then(resolve).catch(reject), 500);
      return;
    }

    isConnecting = true;

    if (rpc) {
      try {
        rpc.destroy().catch(() => {});
      } catch (e) {}
      rpc = null;
      discordConnected = false;
    }

    rpc = new RPC.Client({ transport: 'ipc' });

    rpc.once('ready', () => {
      discordConnected = true;
      currentClientId = clientId;
      isConnecting = false;
      console.log(`✅ Connected to Discord! (CLIENT_ID: ${clientId})`);
      startUpdateCheck();
      resolve();
    });

    rpc.once('error', (err) => {
      isConnecting = false;
      reject(err);
    });

    rpc.login({ clientId }).catch(err => {
      isConnecting = false;
      reject(err);
    });
  });
}

// Test endpoint
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

  lastUpdateTime = Date.now();
  console.log(`Update received at ${new Date().toLocaleTimeString()}`);

  if (!displayName || displayName === 'null' || packageName === 'unknown' || packageName === 'null') {
    if (!isCleared && rpc && discordConnected) {
      rpc.clearActivity().catch(() => {});
      isCleared = true;
    }
    lastUpdateTime = null;
    return res.json({ success: true, message: 'Cleared activity' });
  }
  
  isCleared = false;

  if (!clientId || !clientId.trim()) {
    return res.json({ success: false, message: 'CLIENT_ID required. Set it in the app settings dialog.' });
  }

  const requiredClientId = clientId.trim();
  
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

  const activity = {
    details: displayName,
    startTimestamp: Math.floor(Date.now() / 1000),
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

// Function to check if mobile app is still sending updates
function startUpdateCheck() {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
  }
  
  updateCheckInterval = setInterval(() => {
    if (!discordConnected) {
      return;
    }
    
    if (lastUpdateTime === null) {
      return;
    }
    
    const timeSinceLastUpdate = Date.now() - lastUpdateTime;
    
    if (timeSinceLastUpdate >= UPDATE_TIMEOUT) {
      if (!isCleared) {
        rpc.clearActivity().then(() => {
          isCleared = true;
          lastUpdateTime = null;
        }).catch(() => {});
      }
    }
  }, 30000);
}

// Start server function
function startServer() {
  return new Promise((resolve) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server: http://${localIP}:${PORT}`);
      resolve({
        ip: localIP,
        port: PORT,
        discordConnected
      });
    });
  });
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

// Export for Electron
module.exports = { startServer };

// Export connection status getter
module.exports.getStatus = () => ({
  discordConnected,
  ip: localIP,
  port: PORT
});

