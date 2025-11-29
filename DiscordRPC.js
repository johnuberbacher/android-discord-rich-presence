/**
 * Discord Rich Presence Service
 * Uses Discord Gateway WebSocket API (similar to Kizzy)
 * 
 * WARNING: This uses Discord Gateway directly, which may violate Discord's ToS.
 * Use at your own risk. This is for educational purposes.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const DISCORD_API_URL = 'https://discord.com/api/v10';

class DiscordRPC {
  constructor() {
    this.ws = null;
    this.token = null;
    this.sessionId = null;
    this.sequence = null;
    this.heartbeatInterval = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.applicationId = null;
  }

  /**
   * Initialize Discord RPC with user token
   * @param {string} token - Discord user token (get from browser DevTools)
   * @param {string} applicationId - Discord Application ID (optional, for custom app)
   */
  async initialize(token, applicationId = null) {
    if (!token) {
      throw new Error('Discord token is required');
    }

    this.token = token;
    this.applicationId = applicationId || '1021854273544200192'; // Default app ID (can be changed)
    
    // Store token securely
    try {
      await AsyncStorage.setItem('@discord_token', token);
      if (applicationId) {
        await AsyncStorage.setItem('@discord_app_id', applicationId);
      }
    } catch (error) {
      // Could not store Discord token
    }

    return this.connect();
  }

  /**
   * Connect to Discord Gateway
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(DISCORD_GATEWAY_URL);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleGatewayMessage(data);
          } catch (error) {
            // Error parsing message
          }
        };

        this.ws.onerror = (error) => {
          reject(error);
        };

        this.ws.onclose = (event) => {
          this.isConnected = false;
          
          if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
          }

          // Attempt to reconnect if not intentional
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => this.connect(), 3000 * this.reconnectAttempts);
          }
        };

        // Resolve after a short delay to allow connection to establish
        setTimeout(() => {
          if (this.ws.readyState === WebSocket.OPEN) {
            resolve();
          } else {
            reject(new Error('Failed to establish WebSocket connection'));
          }
        }, 1000);

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming Gateway messages
   */
  handleGatewayMessage(data) {
    const { op, d, s, t } = data;

    if (s !== null) {
      this.sequence = s;
    }

    switch (op) {
      case 10: // Hello - Start heartbeat
        const heartbeatInterval = d.heartbeat_interval;
        this.startHeartbeat(heartbeatInterval);
        this.identify();
        break;

      case 11: // Heartbeat ACK
        // Heartbeat acknowledged
        break;

      case 0: // Dispatch event
        this.handleDispatchEvent(t, d);
        break;

      case 7: // Reconnect
        this.ws.close();
        setTimeout(() => this.connect(), 1000);
        break;

      case 9: // Invalid session
        setTimeout(() => this.identify(), 1000);
        break;

      default:
        // Unhandled op code
    }
  }

  /**
   * Handle dispatch events
   */
  handleDispatchEvent(eventType, data) {
    switch (eventType) {
      case 'READY':
        this.sessionId = data.session_id;
        this.isConnected = true;
        break;

      case 'RESUMED':
        this.isConnected = true;
        break;

      default:
        // Other events can be handled here if needed
        break;
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  startHeartbeat(interval) {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({
          op: 1,
          d: this.sequence
        });
      }
    }, interval);
  }

  /**
   * Identify with Discord Gateway
   */
  identify() {
    this.send({
      op: 2,
      d: {
        token: this.token,
        properties: {
          os: 'Android',
          browser: 'Discord Android',
          device: 'Discord Android'
        },
        presence: {
          status: 'online',
          since: null,
          activities: [],
          afk: false
        },
        intents: 0
      }
    });
  }

  /**
   * Update Discord Rich Presence
   * @param {Object} activity - Activity object
   */
  setActivity(activity) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const activityData = {
      name: activity.name || 'Unknown App',
      type: activity.type || 0, // 0 = Playing, 1 = Streaming, 2 = Listening, 3 = Watching, 4 = Custom, 5 = Competing
      details: activity.details || null,
      state: activity.state || null,
      timestamps: activity.timestamps || null,
      assets: activity.assets || null,
      buttons: activity.buttons || null,
      application_id: activity.applicationId || this.applicationId
    };

    // Remove null values
    Object.keys(activityData).forEach(key => {
      if (activityData[key] === null) {
        delete activityData[key];
      }
    });

    this.send({
      op: 3,
      d: {
        since: Date.now(),
        activities: [activityData],
        status: 'online',
        afk: false
      }
    });
  }

  /**
   * Clear Rich Presence
   */
  clearActivity() {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.send({
      op: 3,
      d: {
        since: null,
        activities: [],
        status: 'online',
        afk: false
      }
    });
  }

  /**
   * Send message to Gateway
   */
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Disconnect from Discord Gateway
   */
  disconnect() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Intentional disconnect');
      this.ws = null;
    }

    this.isConnected = false;
    this.sessionId = null;
    this.sequence = null;
  }

  /**
   * Load saved token from storage
   */
  async loadSavedToken() {
    try {
      const token = await AsyncStorage.getItem('@discord_token');
      const appId = await AsyncStorage.getItem('@discord_app_id');
      
      if (token) {
        this.token = token;
        if (appId) {
          this.applicationId = appId;
        }
        return { token, applicationId: appId };
      }
    } catch (error) {
      // Error loading saved token
    }
    return null;
  }

  /**
   * Clear saved token
   */
  async clearSavedToken() {
    try {
      await AsyncStorage.removeItem('@discord_token');
      await AsyncStorage.removeItem('@discord_app_id');
    } catch (error) {
      // Error clearing saved token
    }
  }
}

// Export singleton instance
const discordRPC = new DiscordRPC();
export default discordRPC;

