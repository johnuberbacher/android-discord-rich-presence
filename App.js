import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, AppState, NativeModules, FlatList, ScrollView, Alert } from 'react-native';
import { Appbar, IconButton, PaperProvider, Text, TextInput, Button, Dialog, Portal, Switch, Card, Paragraph, useTheme } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import desktopRPC from './DesktopRPC';

const { ForegroundAppModule } = NativeModules;

// Notification ID for persistent foreground notification
const FOREGROUND_NOTIFICATION_ID = 'foreground-service-notification';

// Store the latest notification data for restoration if dismissed
let lastNotificationData = { title: 'Hello World', body: 'Hello World', details: '' };

// Track last logged app to reduce console spam
let lastLoggedApp = null;
let lastLogTime = 0;

// Track the last package that was actively being updated to Discord
let lastUpdatedPackage = null;

// Track the last notification title to detect changes
let lastNotificationTitle = null;

// Storage keys
const PACKAGES_STORAGE_KEY = '@packages_seen';
const CUSTOM_NAMES_STORAGE_KEY = '@custom_names';
const CLIENT_IDS_STORAGE_KEY = '@client_ids';
const ENABLED_APPS_STORAGE_KEY = '@enabled_apps';
const DESKTOP_IP_KEY = '@desktop_ip';
const DESKTOP_ENABLED_KEY = '@desktop_enabled';

// Function to get custom name for package, or return package name
const getDisplayName = async (packageName) => {
  try {
    const customNamesJson = await AsyncStorage.getItem(CUSTOM_NAMES_STORAGE_KEY);
    const customNames = customNamesJson ? JSON.parse(customNamesJson) : {};
    return customNames[packageName] || packageName;
  } catch (error) {
    return packageName;
  }
};

// Function to check if an app is enabled
// Apps are disabled by default and can only be enabled if they have a CLIENT_ID
const isAppEnabled = async (packageName) => {
  try {
    const enabledAppsJson = await AsyncStorage.getItem(ENABLED_APPS_STORAGE_KEY);
    const enabledApps = enabledAppsJson ? JSON.parse(enabledAppsJson) : {};
    
    // Check if app has a CLIENT_ID
    const clientId = await getClientIdForPackage(packageName);
    
    // Can only be enabled if CLIENT_ID is set AND explicitly enabled
    if (clientId) {
      return enabledApps[packageName] === true;
    } else {
      // No CLIENT_ID - always disabled
      return false;
    }
  } catch (error) {
    return false; // Default to disabled on error
  }
};

// Function to store a package name
const storePackage = async (packageName) => {
  try {
    if (!packageName || packageName === 'null' || packageName === 'unknown') return;
    
    const packagesJson = await AsyncStorage.getItem(PACKAGES_STORAGE_KEY);
    const packages = packagesJson ? JSON.parse(packagesJson) : [];
    
    if (!packages.includes(packageName)) {
      packages.push(packageName);
      await AsyncStorage.setItem(PACKAGES_STORAGE_KEY, JSON.stringify(packages));
    }
  } catch (error) {
    // Error storing package
  }
};

// Function to get CLIENT_ID for a package
const getClientIdForPackage = async (packageName) => {
  try {
    const clientIdsJson = await AsyncStorage.getItem(CLIENT_IDS_STORAGE_KEY);
    const clientIds = clientIdsJson ? JSON.parse(clientIdsJson) : {};
    return clientIds[packageName] || null;
  } catch (error) {
    return null;
  }
};

// Function to update Discord Rich Presence via desktop app
const updateDiscordRPC = async (displayName, packageName, setDesktopConnectedCallback = null) => {
  try {
    if (!desktopRPC.isConnected) {
      return;
    }

    // Get CLIENT_ID for this package - required
    const clientId = await getClientIdForPackage(packageName);
    
    // Skip if no CLIENT_ID is set
    if (!clientId) {
      return;
    }

    // Update Discord Rich Presence via desktop app
    await desktopRPC.setActivity(displayName, packageName, clientId);
    
    // Check connection status after successful update (throttled to avoid too many checks)
    if (setDesktopConnectedCallback) {
      const now = Date.now();
      if (!updateDiscordRPC.lastStatusCheck || (now - updateDiscordRPC.lastStatusCheck) > 10000) {
        updateDiscordRPC.lastStatusCheck = now;
        try {
          const health = await desktopRPC.testConnection();
          setDesktopConnectedCallback(health.connected);
        } catch (error) {
          setDesktopConnectedCallback(false);
        }
      }
    }
  } catch (error) {
    // Error updating Discord RPC
    if (setDesktopConnectedCallback) {
      setDesktopConnectedCallback(false);
    }
  }
};

// Function to get foreground app name and update notification
const updateNotificationWithForegroundApp = async (updateDiscord = true, setDesktopConnectedCallback = null) => {
  try {
    if (ForegroundAppModule) {
      const result = await ForegroundAppModule.getForegroundAppName();
      // Parse debug info: appName|packageName|method|debugInfo
      const parts = result.split('|');
      const appName = parts[0] || 'null';
      const packageName = parts[1] || 'unknown';
      const method = parts[2] || 'unknown';
      const debugInfo = parts[3] || '';
      
      // Check if app name or package name is null/empty (e.g., when this app is in foreground)
      const isNullApp = !appName || appName === 'null' || !packageName || packageName === 'null' || packageName === 'unknown';
      
      if (isNullApp) {
        // Show "No app detected" when app is null or this app is in foreground
        await updateForegroundNotification('No app detected', '');
        // Clear Discord status if we were updating an app
        if (lastUpdatedPackage && desktopRPC.isConnected && updateDiscord) {
          await desktopRPC.clearActivity();
          lastUpdatedPackage = null;
        }
        return;
      }
      
      // Track app changes - if package changed, we need to update notification immediately
      const packageChanged = lastLoggedApp !== packageName;
      const shouldLog = !lastLoggedApp || packageChanged || (Date.now() - lastLogTime) > 10000;
      if (shouldLog) {
        lastLoggedApp = packageName;
        lastLogTime = Date.now();
      }
      
      // Store the package (always store, even if not enabled)
      if (packageName !== 'unknown' && packageName !== 'null') {
        await storePackage(packageName);
      }
      
      // Check if app is enabled (must have client_id set AND be toggled ON)
      const appEnabled = await isAppEnabled(packageName);
      
      // Show "No App Detected" UNLESS the app has its client_id set AND its been toggled ON
      if (appEnabled) {
        // Get custom display name
        const displayName = await getDisplayName(packageName);
        
        // Show in notification
        const title = displayName;
        const body = packageName;
        
        await updateForegroundNotification(title, body);
        
        // Only send updates for the app currently in the notification
        // If we were updating a different app, clear Discord status first
        if (lastUpdatedPackage && lastUpdatedPackage !== packageName) {
          // Switched from a different app - clear Discord status
          if (desktopRPC.isConnected && updateDiscord) {
            await desktopRPC.clearActivity();
          }
        }
        
        // Update Discord RPC if enabled
        if (updateDiscord) {
          if (desktopRPC.isConnected) {
            // Try to send update - connection check happens in DesktopRPC if needed
            await updateDiscordRPC(displayName, packageName, setDesktopConnectedCallback);
            // Track that we're now updating this package
            lastUpdatedPackage = packageName;
          }
        }
      } else {
        // App doesn't have client_id set OR is not toggled ON - show "No app detected"
        // Always update notification immediately to reflect current state
        await updateForegroundNotification('No app detected', '');
        
        // If we were updating an app (any app), clear Discord status when switching to untoggled app
        if (lastUpdatedPackage && desktopRPC.isConnected && updateDiscord) {
          await desktopRPC.clearActivity();
          lastUpdatedPackage = null;
        }
      }
    } else {
      await updateForegroundNotification('null', 'Module not available');
    }
  } catch (error) {
    await updateForegroundNotification('null', `Error: ${error.message}`);
  }
};

// Function to update notification with dynamic strings
// Export this so you can call it from anywhere in your app to update the notification
export const updateForegroundNotification = async (title = 'Hello World', body = 'Hello World', details = '') => {
  // Handle null values - show "No app detected" if title or body is null/empty
  const displayTitle = (!title || title === 'null' || title.trim() === '') ? 'No app detected' : title;
  const displayBody = (!body || body === 'null' || body.trim() === '') ? '' : body;
  
  // Always update notification, even if title appears the same (to ensure it reflects current state)
  // Store the latest notification data for restoration if dismissed
  lastNotificationData = { title: displayTitle, body: displayBody, details };
  lastNotificationTitle = displayTitle;
  
  // Create a channel (required for Android)
  const channelId = await notifee.createChannel({
    id: 'foreground-service',
    name: 'Foreground Service',
    importance: AndroidImportance.LOW, // Lower importance - only shows in notification panel
  });

  // Display notification as foreground service (but not persistent on screen)
  // Always update to ensure it reflects the current foreground app state
  await notifee.displayNotification({
    id: FOREGROUND_NOTIFICATION_ID,
    title: displayTitle,
    body: displayBody + (details ? ` - ${details}` : ''),
      android: {
      channelId,
      smallIcon: 'ic_notification', // Use notification icon drawable
      asForegroundService: true, // Required for foreground service to keep running
      ongoing: true, // Make it ongoing to prevent dismissal and improve persistence
      autoCancel: false, // Prevents auto-dismissal
      importance: AndroidImportance.LOW, // Low importance - only in notification panel
      showTimestamp: false, // Prevents timestamp display
      pressAction: {
        id: 'default',
      },
    },
  });
};

export default function App() {
  const notificationIntervalRef = useRef(null);
  const packagesReloadIntervalRef = useRef(null);
  const connectionCheckIntervalRef = useRef(null);
  const [packages, setPackages] = useState([]);
  const [editingPackage, setEditingPackage] = useState(null);
  const [editText, setEditText] = useState('');
  const [editClientId, setEditClientId] = useState('');
  const [testingClientId, setTestingClientId] = useState(false);
  const [clientIdTestResult, setClientIdTestResult] = useState(null);
  const [customNames, setCustomNames] = useState({});
  const [clientIds, setClientIds] = useState({});
  const [enabledApps, setEnabledApps] = useState({});
  
  // Desktop RPC state
  const [desktopIP, setDesktopIP] = useState('');
  const [desktopConnected, setDesktopConnected] = useState(false);
  const [desktopEnabled, setDesktopEnabled] = useState(false);
  const [showDesktopSettings, setShowDesktopSettings] = useState(false);
  const [desktopConnecting, setDesktopConnecting] = useState(false);
  // Battery optimization state - disabled until app rebuild
  // const [isIgnoringBatteryOptimizations, setIsIgnoringBatteryOptimizations] = useState(true);
  const isIgnoringBatteryOptimizations = true; // Always true until rebuild

  useEffect(() => {
    // Register foreground service handler
    // This keeps the service running even when app is in background or another app is open
    // The service continues until explicitly stopped or app is force-closed
    notifee.registerForegroundService((notification) => {
      return new Promise(() => {
        // This promise never resolves, keeping the service running
        // The service will stop when the app is closed or stopForegroundService is called
        // Foreground services continue running even when app is backgrounded
      });
    });

    // Register background event handler to fix warning
    notifee.onBackgroundEvent(async ({ type, detail }) => {
      // Handle background events if needed
      // Currently just prevents the warning
    });

    // Request permissions and start foreground service
    const startForegroundService = async () => {
      const settings = await notifee.requestPermission();
      if (settings.authorizationStatus >= 1) {
        // Check if usage stats permission is granted
        if (ForegroundAppModule) {
          try {
            const hasPermission = await ForegroundAppModule.isUsageStatsPermissionGranted();
            if (!hasPermission) {
              // PACKAGE_USAGE_STATS permission not granted
            }
            
            // Check battery optimization status (disabled until app rebuild)
            // TODO: Uncomment after rebuilding the app with new native methods
            // try {
            //   const isIgnoringBattery = await ForegroundAppModule.isIgnoringBatteryOptimizations();
            //   setIsIgnoringBatteryOptimizations(isIgnoringBattery);
            // } catch (error) {
            //   setIsIgnoringBatteryOptimizations(true);
            // }
            // For now, default to true to hide warning until rebuild
            // setIsIgnoringBatteryOptimizations(true);
          } catch (error) {
            // Error checking usage stats permission
          }
        }
        // Start with default "No app detected" since we're not in background yet
        await updateForegroundNotification('No app detected', '');
      }
    };

    startForegroundService();

    // Load packages, custom names, client IDs, and enabled apps on startup
    const loadPackages = async () => {
      try {
        // Batch AsyncStorage reads for better performance
        const keys = [PACKAGES_STORAGE_KEY, CUSTOM_NAMES_STORAGE_KEY, CLIENT_IDS_STORAGE_KEY, ENABLED_APPS_STORAGE_KEY];
        const results = await AsyncStorage.multiGet(keys);
        const data = Object.fromEntries(results);
        
        const loadedPackages = data[PACKAGES_STORAGE_KEY] ? JSON.parse(data[PACKAGES_STORAGE_KEY]) : [];
        setPackages(loadedPackages);
        
        const loadedCustomNames = data[CUSTOM_NAMES_STORAGE_KEY] ? JSON.parse(data[CUSTOM_NAMES_STORAGE_KEY]) : {};
        setCustomNames(loadedCustomNames);
        
        const loadedClientIds = data[CLIENT_IDS_STORAGE_KEY] ? JSON.parse(data[CLIENT_IDS_STORAGE_KEY]) : {};
        setClientIds(loadedClientIds);
        
        const loadedEnabledApps = data[ENABLED_APPS_STORAGE_KEY] ? JSON.parse(data[ENABLED_APPS_STORAGE_KEY]) : {};
        setEnabledApps(loadedEnabledApps);
      } catch (error) {
        // Error loading packages
      }
    };

    loadPackages();

    // Load desktop app settings
    const loadDesktopSettings = async () => {
      try {
        const saved = await desktopRPC.loadSavedIP();
        if (saved && saved.ip) {
          setDesktopIP(saved.ip);
          if (saved.enabled) {
            setDesktopEnabled(true);
            // Try to connect
            connectDesktop(saved.ip);
          }
        }
      } catch (error) {
        // Error loading desktop settings
      }
    };

    loadDesktopSettings();

    // Reload packages periodically when app is active (reduced frequency for better performance)
    packagesReloadIntervalRef.current = setInterval(() => {
      if (AppState.currentState === 'active') {
        loadPackages();
      }
    }, 5000);

    // Function to restore notification if it was dismissed
    const restoreNotification = async () => {
      try {
        const { title, body, details } = lastNotificationData;
        await updateForegroundNotification(title, body, details);
      } catch (error) {
        // Error restoring notification
      }
    };

    // Monitor periodically to update notification when in background
    // Note: We don't auto-restore if dismissed since user may want to dismiss it
    const checkAndUpdateNotification = async () => {
      try {
        const notifications = await notifee.getDisplayedNotifications();
        const notificationExists = notifications.some(
          (n) => n.id === FOREGROUND_NOTIFICATION_ID
        );
        
        // Only update if notification exists and app is in background
        if (notificationExists && AppState.currentState === 'background') {
          await updateNotificationWithForegroundApp(true, setDesktopConnected);
        }
      } catch (error) {
        // Error checking notification
      }
    };

    // Listen to app state changes
    const appStateSubscription = AppState.addEventListener('change', async (nextAppState) => {
      // When app enters background, update notification with foreground app name
      if (nextAppState === 'background') {
        await updateNotificationWithForegroundApp(true, setDesktopConnected);
      } else if (nextAppState === 'inactive') {
        // Device locked or app interrupted - clear Discord status
        if (desktopRPC.isConnected) {
          await desktopRPC.clearActivity();
          lastUpdatedPackage = null;
        }
      } else if (nextAppState === 'active') {
        // Reload packages when app comes to foreground
        loadPackages();
        // Immediately check and update foreground app when app becomes active
        await updateNotificationWithForegroundApp(true, setDesktopConnected);
      }
    });

    // Update notification periodically (every 1 second) - works in both background and active states
    notificationIntervalRef.current = setInterval(() => {
      updateNotificationWithForegroundApp(true, setDesktopConnected);
    }, 1000);

    // Check connection validity every 15 seconds
    connectionCheckIntervalRef.current = setInterval(async () => {
      if (desktopRPC.isConnected && desktopEnabled) {
        try {
          const health = await desktopRPC.testConnection();
          setDesktopConnected(health.connected);
        } catch (error) {
          setDesktopConnected(false);
        }
      }
    }, 15000);

    // Cleanup: stop foreground service when component unmounts
    return () => {
      if (notificationIntervalRef.current) {
        clearInterval(notificationIntervalRef.current);
      }
      if (packagesReloadIntervalRef.current) {
        clearInterval(packagesReloadIntervalRef.current);
      }
      if (connectionCheckIntervalRef.current) {
        clearInterval(connectionCheckIntervalRef.current);
      }
      appStateSubscription.remove();
      notifee.stopForegroundService();
      // Disconnect desktop RPC
      if (desktopRPC.isConnected) {
        desktopRPC.disable().catch(() => {});
      }
    };
  }, []);

  // Connect to desktop app
  const connectDesktop = async (ipAddress) => {
    if (!ipAddress || ipAddress.trim() === '') {
      Alert.alert('Error', 'Desktop IP address is required');
      return;
    }

    setDesktopConnecting(true);
    try {
      await desktopRPC.initialize(ipAddress.trim());
      const health = await desktopRPC.testConnection();
      setDesktopConnected(health.connected);
      setDesktopEnabled(true);
      Alert.alert('Success', `Connected to desktop app!${health.connected ? '\nDiscord is connected.' : '\nWaiting for Discord connection...'}`);
      
      // Update RPC with current app
      await updateNotificationWithForegroundApp(true, setDesktopConnected);
    } catch (error) {
      console.error('Connection error:', error);
      const errorMessage = error?.message || String(error) || 'Unknown error';
      Alert.alert('Error', `Failed to connect: ${errorMessage}\n\nMake sure:\n• Desktop app is running\n• Both devices on same WiFi\n• IP address is correct\n• Network permissions are granted`);
      setDesktopConnected(false);
    } finally {
      setDesktopConnecting(false);
    }
  };

  // Disconnect from desktop app
  const disconnectDesktop = async () => {
    try {
      await desktopRPC.disable();
      setDesktopConnected(false);
      setDesktopEnabled(false);
      Alert.alert('Success', 'Disconnected from desktop app');
    } catch (error) {
      // Error disconnecting from desktop app
    }
  };

  // Request battery optimization exemption (disabled until app rebuild)
  const requestBatteryOptimizationExemption = async () => {
    Alert.alert('Info', 'Battery optimization feature requires app rebuild. Please rebuild the app to use this feature.');
    // TODO: Uncomment after rebuilding the app with new native methods
    // try {
    //   await ForegroundAppModule.requestIgnoreBatteryOptimizations();
    //   setTimeout(async () => {
    //     try {
    //       const isIgnoring = await ForegroundAppModule.isIgnoringBatteryOptimizations();
    //       setIsIgnoringBatteryOptimizations(isIgnoring);
    //     } catch (error) {
    //       // Error re-checking
    //     }
    //   }, 1000);
    // } catch (error) {
    //   Alert.alert('Error', 'Failed to open battery optimization settings');
    // }
  };

  // Save desktop settings
  const saveDesktopSettings = async () => {
    try {
      if (desktopIP.trim()) {
        if (desktopConnected) {
          await disconnectDesktop();
        }
        await connectDesktop(desktopIP.trim());
      } else {
        setShowDesktopSettings(false);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to save settings');
    }
  };

  const handleEditPackage = (packageName) => {
    setEditingPackage(packageName);
    setEditText(customNames[packageName] || packageName);
    setEditClientId(clientIds[packageName] || '');
    setClientIdTestResult(null);
  };

  const saveCustomName = async () => {
    if (!editingPackage) return;
    
    try {
      const newCustomNames = { ...customNames };
      if (editText.trim() && editText.trim() !== editingPackage) {
        newCustomNames[editingPackage] = editText.trim();
      } else {
        delete newCustomNames[editingPackage];
      }
      
      const newClientIds = { ...clientIds };
      const hadClientId = !!clientIds[editingPackage];
      const hasClientId = !!editClientId.trim();
      
      if (hasClientId) {
        newClientIds[editingPackage] = editClientId.trim();
      } else {
        delete newClientIds[editingPackage];
      }
      
      // Update enabled state based on CLIENT_ID changes
      const newEnabledApps = { ...enabledApps };
      if (!hasClientId && hadClientId) {
        // CLIENT_ID was removed - disable the app
        delete newEnabledApps[editingPackage];
      }
      // If CLIENT_ID was added, keep current enabled state (defaults to disabled)
      
      // Batch AsyncStorage writes for better performance
      await AsyncStorage.multiSet([
        [CUSTOM_NAMES_STORAGE_KEY, JSON.stringify(newCustomNames)],
        [CLIENT_IDS_STORAGE_KEY, JSON.stringify(newClientIds)],
        [ENABLED_APPS_STORAGE_KEY, JSON.stringify(newEnabledApps)],
      ]);
      setCustomNames(newCustomNames);
      setClientIds(newClientIds);
      setEnabledApps(newEnabledApps);
      setEditingPackage(null);
      setEditText('');
      setEditClientId('');
      setClientIdTestResult(null);
    } catch (error) {
      // Error saving custom name
    }
  };

  const getDisplayNameForList = (packageName) => {
    return customNames[packageName] || packageName;
  };

  // Helper to check if app is enabled (considering CLIENT_ID) for UI display
  // Apps can only be enabled if they have a CLIENT_ID set
  const isAppEnabledForList = (packageName) => {
    const hasClientId = !!clientIds[packageName];
    if (!hasClientId) {
      // No CLIENT_ID - always disabled
      return false;
    }
    // Has CLIENT_ID - must be explicitly enabled
    return enabledApps[packageName] === true;
  };

  const toggleAppEnabled = async (packageName) => {
    try {
      const hasClientId = !!clientIds[packageName];
      
      // Can only toggle if CLIENT_ID is set
      if (!hasClientId) {
        Alert.alert('CLIENT_ID Required', 'Please set a CLIENT_ID before enabling this app.');
        return;
      }
      
      const newEnabledApps = { ...enabledApps };
      const currentlyEnabled = enabledApps[packageName] === true;
      
      // Toggle explicit enabled state
      newEnabledApps[packageName] = !currentlyEnabled;
      
      await AsyncStorage.setItem(ENABLED_APPS_STORAGE_KEY, JSON.stringify(newEnabledApps));
      setEnabledApps(newEnabledApps);
    } catch (error) {
      // Error toggling app enabled state
    }
  };

  // Test CLIENT_ID by attempting to connect to Discord
  const testClientId = async () => {
    if (!editClientId.trim()) {
      Alert.alert('Error', 'Please enter a CLIENT_ID to test');
      return;
    }

    if (!desktopRPC.isConnected) {
      Alert.alert('Error', 'Please connect to desktop app first');
      return;
    }

    setTestingClientId(true);
    setClientIdTestResult(null);

    try {
      // Send a test update with the CLIENT_ID
      const testDisplayName = 'Test Connection';
      const testPackageName = editingPackage || 'test';
      
      await desktopRPC.setActivity(testDisplayName, testPackageName, editClientId.trim());
      
      // Wait a moment to see if it succeeds
      setTimeout(() => {
        setClientIdTestResult('success');
        setTestingClientId(false);
        Alert.alert('Success', 'CLIENT_ID is valid! Discord connection successful.');
      }, 1000);
    } catch (error) {
      setClientIdTestResult('error');
      setTestingClientId(false);
      Alert.alert('Error', `Failed to connect with this CLIENT_ID: ${error.message}`);
    }
  };

  return (
    <PaperProvider>
      <AppContent
        packages={packages}
        editingPackage={editingPackage}
        editText={editText}
        editClientId={editClientId}
        testingClientId={testingClientId}
        clientIdTestResult={clientIdTestResult}
        customNames={customNames}
        clientIds={clientIds}
        enabledApps={enabledApps}
        desktopIP={desktopIP}
        desktopConnected={desktopConnected}
        desktopEnabled={desktopEnabled}
        showDesktopSettings={showDesktopSettings}
        desktopConnecting={desktopConnecting}
        setEditingPackage={setEditingPackage}
        setEditText={setEditText}
        setEditClientId={setEditClientId}
        setClientIdTestResult={setClientIdTestResult}
        setDesktopIP={setDesktopIP}
        setShowDesktopSettings={setShowDesktopSettings}
        handleEditPackage={handleEditPackage}
        saveCustomName={saveCustomName}
        getDisplayNameForList={getDisplayNameForList}
        isAppEnabledForList={isAppEnabledForList}
        toggleAppEnabled={toggleAppEnabled}
        testClientId={testClientId}
        connectDesktop={connectDesktop}
        disconnectDesktop={disconnectDesktop}
        saveDesktopSettings={saveDesktopSettings}
      />
    </PaperProvider>
  );
}

function AppContent({
  packages,
  editingPackage,
  editText,
  editClientId,
  testingClientId,
  clientIdTestResult,
  customNames,
  clientIds,
  enabledApps,
  desktopIP,
  desktopConnected,
  desktopEnabled,
  showDesktopSettings,
  desktopConnecting,
  setEditingPackage,
  setEditText,
  setEditClientId,
  setClientIdTestResult,
  setDesktopIP,
  setShowDesktopSettings,
  handleEditPackage,
  saveCustomName,
  getDisplayNameForList,
  isAppEnabledForList,
  toggleAppEnabled,
  testClientId,
  connectDesktop,
  disconnectDesktop,
  saveDesktopSettings,
}) {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Appbar.Header>
          <Appbar.Content title="Discord Rich Presence" />
          <Button
            mode="contained"
            onPress={() => setShowDesktopSettings(true)}
            buttonColor={desktopConnected ? '#57F287' : '#ff6b6b'}
            textColor={desktopConnected ? '#000000' : '#ffffff'}
            style={styles.discordButton}
          >
            {desktopConnected ? 'Connected' : 'Disconnected'}
          </Button>
        </Appbar.Header>
      {packages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text variant="bodyLarge" style={styles.emptyText}>No apps detected yet. Switch to another app to see it here.</Text>
          <Text variant="bodyMedium" style={styles.emptyHint}>
            Note: Make sure you've enabled Usage Access for this app in Settings → Apps → Special Access → Usage Access. The app won't work without this permission.
          </Text>
        </View>
      ) : (
        <View style={styles.listContainer}><FlatList
        data={packages}
        keyExtractor={(item) => item}
        style={styles.list}
        renderItem={({ item }) => (
          <Card style={styles.packageItem} onPress={() => {
            if (clientIds[item]) {
              toggleAppEnabled(item);
            }
          }}>
            <Card.Content>
              <View style={styles.packageItemContent}>
                <View style={styles.packageItemText}>
                  <Text variant="titleMedium" style={styles.packageName}>{getDisplayNameForList(item)}</Text>
                  <Text variant="bodySmall" style={styles.packageId}>{item}</Text>
                </View>
                <View style={styles.packageItemActions}>
                  <Switch
                    value={isAppEnabledForList(item)}
                    onValueChange={() => toggleAppEnabled(item)}
                    disabled={!clientIds[item]}
                  />
                  <IconButton
                    icon="pencil"
                    mode="contained-tonal"
                    onPress={() => handleEditPackage(item)}
                    style={styles.editButton}
                  />
                </View>
              </View>
            </Card.Content>
          </Card>
        )}
      />
   </View>   )}
      
      <Portal>
        <Dialog
          visible={editingPackage !== null}
          onDismiss={() => {
            setEditingPackage(null);
            setEditText('');
            setEditClientId('');
            setClientIdTestResult(null);
          }}
          dismissable={true}
          dismissableBackButton={true}
          style={styles.dialog}
        >
          <Dialog.Title>Edit App Settings</Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView contentContainerStyle={styles.dialogScrollContent}>
              <Text variant="bodySmall" style={styles.modalPackageId}>{editingPackage}</Text>
              
              <TextInput
                label="Custom Name"
                value={editText}
                onChangeText={setEditText}
                placeholder="Enter custom name"
                mode="outlined"
                style={styles.textInput}
              />
              <Paragraph variant="bodySmall" style={styles.inputHint}>
                This will appear in the notification and Discord Rich Presence (details field)
              </Paragraph>
              
              <View style={styles.clientIdContainer}>
                <TextInput
                  label="Discord CLIENT_ID (Required)"
                  value={editClientId}
                  onChangeText={(text) => {
                    setEditClientId(text);
                    setClientIdTestResult(null);
                  }}
                  placeholder="Enter Discord CLIENT_ID"
                  mode="outlined"
                  style={[styles.textInput, styles.clientIdInput]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="numeric"
                />
                <Button
                  mode="contained"
                  onPress={testClientId}
                  disabled={testingClientId || !editClientId.trim() || !desktopConnected}
                  style={styles.testButton}
                  loading={testingClientId}
                >
                  Test
                </Button>
              </View>
              <Paragraph variant="bodySmall" style={styles.inputHint}>
                Create a Discord app at discord.com/developers/applications and enter its Application ID here.
                This is required for Discord Rich Presence to work.
              </Paragraph>
              {clientIdTestResult === 'success' && (
                <Text variant="bodySmall" style={styles.testSuccessText}>✓ CLIENT_ID is valid</Text>
              )}
              {clientIdTestResult === 'error' && (
                <Text variant="bodySmall" style={styles.testErrorText}>✗ CLIENT_ID test failed</Text>
              )}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setEditingPackage(null);
                setEditText('');
                setEditClientId('');
                setClientIdTestResult(null);
              }}
              style={styles.dialogButton}
              contentStyle={styles.dialogButtonContent}
            >
              Cancel
            </Button>
            <Button 
              mode="contained" 
              onPress={saveCustomName}
              disabled={!editClientId.trim()}
              style={styles.dialogButton}
              contentStyle={styles.dialogButtonContent}
            >
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Portal>
        <Dialog
          visible={showDesktopSettings}
          onDismiss={() => setShowDesktopSettings(false)}
          dismissable={true}
          dismissableBackButton={true}
          style={styles.dialog}
        >
          <Dialog.Title>Desktop Companion App</Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView contentContainerStyle={styles.dialogScrollContent}>
              <Paragraph variant="bodyMedium" style={styles.modalDescription}>
                Connect to your desktop companion app to show your current app as Discord Rich Presence.
              </Paragraph>
              <View style={[styles.infoBox, { backgroundColor: theme.colors.surfaceVariant }]}>
                <Text variant="bodySmall" style={[styles.infoBoxText, { color: theme.colors.onSurfaceVariant }]}>
                  ℹ️ Make sure:{'\n'}• Desktop app is running{'\n'}• Both devices on same WiFi{'\n'}• Enter the IP shown in desktop app
                </Text>
              </View>
              
              {/* Battery optimization warning - disabled until app rebuild */}
              {/* {!isIgnoringBatteryOptimizations && (
                <View style={[styles.infoBox, { borderLeftColor: '#ff9800' }]}>
                  <Text variant="bodySmall" style={styles.infoBoxText}>
                    ⚠️ Battery optimization is enabled. This may cause the app to stop updating when in background.{'\n\n'}
                    For best results, disable battery optimization for this app.
                  </Text>
                  <Button
                    mode="outlined"
                    onPress={requestBatteryOptimizationExemption}
                    style={{ marginTop: 10 }}
                  >
                    Disable Battery Optimization
                  </Button>
                </View>
              )} */}
              
              <TextInput
                label="Desktop App IP Address"
                value={desktopIP}
                onChangeText={setDesktopIP}
                placeholder="192.168.1.100:9090"
                mode="outlined"
                style={styles.textInput}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="default"
              />
              <Paragraph variant="bodySmall" style={styles.inputHint}>
                Enter the IP address shown in your desktop app (e.g., 192.168.1.100:9090)
              </Paragraph>

              <View style={styles.statusContainer}>
                <Text variant="bodyMedium" style={[styles.statusLabel, { color: theme.colors.onSurface }]}>Status:</Text>
                <Text variant="bodyMedium" style={[styles.statusText, desktopConnected && styles.statusConnected]}>
                  {desktopConnecting ? 'Connecting...' : desktopConnected ? 'Connected' : 'Disconnected'}
                </Text>
              </View>
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button 
              onPress={() => setShowDesktopSettings(false)}
              style={styles.dialogButton}
              contentStyle={styles.dialogButtonContent}
            >
              Cancel
            </Button>
            {desktopConnected ? (
              <Button
                mode="contained"
                buttonColor="#ff6b6b"
                onPress={disconnectDesktop}
                style={styles.dialogButton}
                contentStyle={styles.dialogButtonContent}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                mode="contained"
                onPress={saveDesktopSettings}
                disabled={desktopConnecting || !desktopIP.trim()}
                loading={desktopConnecting}
                style={styles.dialogButton}
                contentStyle={styles.dialogButtonContent}
              >
                {desktopConnecting ? 'Connecting...' : 'Connect'}
              </Button>
            )}
          </Dialog.Actions>
        </Dialog>
      </Portal>
      
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
  },
  discordButton: {
    marginLeft: 10,
    marginRight: 20,
  },
  emptyContainer: {
    padding: 20,
    marginTop: 50,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 15,
  },
  emptyHint: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 10,
    paddingHorizontal: 20,
  },
  listContainer: {
    flex: 1,
    paddingVertical: 10,
  },
  list: {
    flex: 1,
    paddingHorizontal: 20,
  }, 
  packageItem: {
    marginBottom: 10,
  },
  packageItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  packageItemText: {
    flex: 1,
    marginRight: 10,
  },
  packageItemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  packageName: {
    marginBottom: 5,
  },
  packageId: {
    fontFamily: 'monospace',
  },
  editButton: {
    marginLeft: 5,
  },
  dialog: {
    borderRadius: 8,
    margin: 20,
    maxWidth: 500,
    maxHeight: '80%',
    alignSelf: 'center',
  },
  dialogScrollContent: {
    paddingHorizontal: 0,
    paddingVertical: 8,
  },
  dialogButton: {
    minWidth: 100,
    marginHorizontal: 4,
  },
  dialogButtonContent: {
  },
  modalPackageId: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
    marginBottom: 15,
  },
  textInput: {
    marginBottom: 10,
  },
  modalDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    lineHeight: 20,
  },
  warningText: {
    color: '#ff6b6b',
    fontWeight: '600',
  },
  infoText: {
    color: '#5865F2',
    fontWeight: '500',
  },
  infoBox: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#5865F2',
  },
  infoBoxText: {
    lineHeight: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 10,
    marginBottom: 5,
  },
  inputHint: {
    fontSize: 12,
    color: '#999',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 15,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 10,
  },
  statusText: {
    fontSize: 14,
    color: '#ff6b6b',
    fontWeight: '600',
  },
  statusConnected: {
    color: '#57F287',
  },
  clientIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  clientIdInput: {
    flex: 1,
    marginBottom: 0,
  },
  testButton: {
    minWidth: 80,
    marginLeft: 10,
  },
  testSuccessText: {
    color: '#57F287',
    fontSize: 12,
    marginTop: -15,
    marginBottom: 10,
    fontWeight: '600',
  },
  testErrorText: {
    color: '#ff6b6b',
    fontSize: 12,
    marginTop: -15,
    marginBottom: 10,
    fontWeight: '600',
  },
});
