/**
 * Desktop RPC Service
 * 
 * Communicates with the desktop companion app over local WiFi
 * to update Discord Rich Presence using the official Discord SDK.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const DESKTOP_IP_KEY = '@desktop_ip';
const DESKTOP_ENABLED_KEY = '@desktop_enabled';

class DesktopRPC {
  constructor() {
    this.desktopIP = null;
    this.isEnabled = false;
    this.lastUpdate = null;
    this.updateThrottle = 60000; // Throttle updates to every 60 seconds (1 minute)
  }

  /**
   * Initialize with desktop app IP address
   * @param {string} ipAddress - IP address and port (e.g., "192.168.1.100:8080")
   */
  async initialize(ipAddress) {
    if (!ipAddress || !ipAddress.trim()) {
      throw new Error('Desktop IP address is required');
    }

    // Remove http:// if present
    let ip = ipAddress.trim().replace(/^https?:\/\//, '');
    
    // Add http:// if not present
    if (!ip.startsWith('http://') && !ip.startsWith('https://')) {
      ip = `http://${ip}`;
    }

    this.desktopIP = ip;
    this.isEnabled = true;

    // Save to storage
    try {
      await AsyncStorage.setItem(DESKTOP_IP_KEY, ipAddress.trim());
      await AsyncStorage.setItem(DESKTOP_ENABLED_KEY, 'true');
    } catch (error) {
      console.warn('Could not store desktop IP:', error);
    }

    // Test connection
    return this.testConnection();
  }

  /**
   * Test connection to desktop app
   */
  async testConnection() {
    if (!this.desktopIP) {
      throw new Error('Desktop IP not set');
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${this.desktopIP}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return {
        connected: data.discordConnected || false,
        ip: data.ip,
        port: data.port,
      };
    } catch (error) {
      throw new Error(`Cannot connect to desktop app: ${error.message}`);
    }
  }

  /**
   * Update Discord Rich Presence via desktop app
   * @param {string} displayName - Display name of the app
   * @param {string} packageName - Package name of the app
   */
  async setActivity(displayName, packageName) {
    if (!this.isEnabled || !this.desktopIP) {
      return;
    }

    // Throttle updates
    const now = Date.now();
    if (this.lastUpdate && (now - this.lastUpdate) < this.updateThrottle) {
      return;
    }

    // Skip if app is null or unknown
    if (!displayName || displayName === 'null' || packageName === 'unknown' || packageName === 'null') {
      await this.clearActivity();
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(`${this.desktopIP}/update-presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appName: displayName,
          packageName: packageName,
          displayName: displayName,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      this.lastUpdate = now;
    } catch (error) {
      console.error('Error updating desktop RPC:', error);
      // Don't throw - fail silently to avoid disrupting app
    }
  }

  /**
   * Clear Discord Rich Presence
   */
  async clearActivity() {
    if (!this.isEnabled || !this.desktopIP) {
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      await fetch(`${this.desktopIP}/clear-presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
    } catch (error) {
      console.error('Error clearing desktop RPC:', error);
    }
  }

  /**
   * Disable and disconnect
   */
  async disable() {
    this.isEnabled = false;
    try {
      await AsyncStorage.setItem(DESKTOP_ENABLED_KEY, 'false');
      await this.clearActivity();
    } catch (error) {
      console.error('Error disabling desktop RPC:', error);
    }
  }

  /**
   * Load saved IP from storage
   */
  async loadSavedIP() {
    try {
      const ip = await AsyncStorage.getItem(DESKTOP_IP_KEY);
      const enabled = await AsyncStorage.getItem(DESKTOP_ENABLED_KEY);
      
      if (ip) {
        this.desktopIP = ip;
      }
      if (enabled === 'true') {
        this.isEnabled = true;
      }
      
      return { ip, enabled: enabled === 'true' };
    } catch (error) {
      console.error('Error loading saved IP:', error);
      return null;
    }
  }

  /**
   * Clear saved IP
   */
  async clearSavedIP() {
    try {
      await AsyncStorage.removeItem(DESKTOP_IP_KEY);
      await AsyncStorage.removeItem(DESKTOP_ENABLED_KEY);
      this.desktopIP = null;
      this.isEnabled = false;
    } catch (error) {
      console.error('Error clearing saved IP:', error);
    }
  }

  get isConnected() {
    return this.isEnabled && this.desktopIP !== null;
  }
}

// Export singleton instance
const desktopRPC = new DesktopRPC();
export default desktopRPC;

