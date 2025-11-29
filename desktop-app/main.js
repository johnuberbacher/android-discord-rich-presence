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
  // Create tray icon - try .ico first (better for Windows), then .png
  let icon;
  
  // Try .ico first (preferred for Windows tray icons - supports multiple sizes)
  const iconPathIco = path.join(__dirname, 'icon.ico');
  try {
    icon = nativeImage.createFromPath(iconPathIco);
    if (!icon.isEmpty()) {
      // Successfully loaded .ico - Windows will auto-select best size
    }
  } catch (e) {
    // .ico not found or error, try .png
  }
  
  // Fallback to .png if .ico not found or empty
  if (!icon || icon.isEmpty()) {
    const iconPathPng = path.join(__dirname, 'icon.png');
    try {
      icon = nativeImage.createFromPath(iconPathPng);
      if (!icon.isEmpty()) {
        // Resize PNG to optimal tray icon size (16x16 @ 2x = 32x32 for high DPI)
        // Windows tray icons are typically 16x16, but we want high DPI support
        const size = icon.getSize();
        // If icon is too large, resize it for better quality
        if (size.width > 32 || size.height > 32) {
          icon = icon.resize({ width: 32, height: 32, quality: 'best' });
        } else if (size.width < 16 || size.height < 16) {
          // If too small, scale up
          icon = icon.resize({ width: 32, height: 32, quality: 'best' });
        }
      } else {
        icon = nativeImage.createEmpty();
      }
    } catch (e) {
      icon = nativeImage.createEmpty();
    }
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

