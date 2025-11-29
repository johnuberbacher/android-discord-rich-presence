/**
 * Electron Main Process
 * Creates system tray icon and runs the Express server
 */

const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { startServer, getStatus } = require('./server');

let tray = null;
let serverInfo = null;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    // (We don't have a window, but this prevents multiple instances)
  });

  app.whenReady().then(() => {
    createTray();
    startServer().then((info) => {
      serverInfo = info;
      updateTrayMenu();
    });
  });

  app.on('window-all-closed', (e) => {
    // Don't quit when all windows are closed (we don't have windows)
    e.preventDefault();
  });

  app.on('before-quit', () => {
    // Cleanup on quit
    if (tray) {
      tray.destroy();
    }
  });
}

function createTray() {
  // Create tray icon (you can replace this with a custom icon)
  const iconPath = path.join(__dirname, 'icon.png');
  let icon;
  
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Fallback to a simple icon if file doesn't exist
      icon = nativeImage.createEmpty();
    }
  } catch (e) {
    // Fallback to empty icon
    icon = nativeImage.createEmpty();
  }

  // If no icon file, create a simple colored icon
  if (icon.isEmpty()) {
    icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
  }

  tray = new Tray(icon);
  tray.setToolTip('Discord Rich Presence Companion');
  
  // Create context menu
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;

  const menuItems = [
    {
      label: 'Discord Rich Presence',
      enabled: false
    },
    { type: 'separator' },
    {
      label: serverInfo 
        ? `Server: ${serverInfo.ip}:${serverInfo.port}`
        : 'Starting server...',
      enabled: false
    },
    {
      label: serverInfo?.discordConnected 
        ? 'Discord: Connected'
        : 'Discord: Disconnected',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ];

  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}

// Update menu periodically to show connection status
setInterval(() => {
  if (tray) {
    const status = getStatus();
    serverInfo = {
      ip: status.ip,
      port: status.port,
      discordConnected: status.discordConnected
    };
    updateTrayMenu();
  }
}, 5000);

// Export for server to update status
module.exports = { updateTrayMenu };

