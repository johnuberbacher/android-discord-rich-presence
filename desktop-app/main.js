/**
 * Electron Main Process
 * Creates system tray icon and runs the Express server
 */

const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
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
    // Set app icon for Windows (appears in Task Manager, Alt+Tab, etc.)
    const appPath = app.isPackaged ? path.dirname(process.execPath) : __dirname;
    const appIconPath = path.join(appPath, 'icon.ico');
    try {
      const appIcon = nativeImage.createFromPath(appIconPath);
      if (!appIcon.isEmpty()) {
        app.dock?.setIcon(appIcon); // macOS dock icon
        // Windows uses the .exe icon automatically from electron-builder
      }
    } catch (e) {
      // Icon not found, will use default
    }
    
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
  
  // Get the correct path for icons (works in both dev and production)
  // In production, icons are in resources (extraResources) or same directory as .exe
  // In dev, they're in __dirname
  let appPath;
  if (app.isPackaged) {
    // For packaged apps, try resources folder first, then executable directory
    const resourcesPath = process.resourcesPath || path.join(path.dirname(process.execPath), 'resources');
    appPath = resourcesPath;
    // Also check executable directory as fallback
    const execDir = path.dirname(process.execPath);
    // Try both locations
    if (!fs.existsSync(path.join(appPath, 'icon.ico')) && fs.existsSync(path.join(execDir, 'icon.ico'))) {
      appPath = execDir;
    }
  } else {
    // For development, use __dirname
    appPath = __dirname;
  }
  
  // Try tray-specific icon first (tray-icon.ico), then fallback to main icon
  // This allows different icons for desktop .exe vs system tray
  const iconPaths = [
    path.join(appPath, 'tray-icon.ico'),
    path.join(appPath, 'icon.ico'),
    path.join(appPath, 'tray-icon.png'),
    path.join(appPath, 'icon.png')
  ];
  
  for (const iconPath of iconPaths) {
    try {
      icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        // Successfully loaded icon
        // Resize PNG to optimal tray icon size if needed
        if (iconPath.endsWith('.png')) {
          const size = icon.getSize();
          if (size.width > 32 || size.height > 32) {
            icon = icon.resize({ width: 32, height: 32, quality: 'best' });
          } else if (size.width < 16 || size.height < 16) {
            icon = icon.resize({ width: 32, height: 32, quality: 'best' });
          }
        }
        break; // Found a valid icon, stop searching
      }
    } catch (e) {
      // Continue to next icon path
      continue;
    }
  }
  
  // If no icon found, create a fallback
  if (!icon || icon.isEmpty()) {
    console.error('No tray icon found, using fallback');
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

