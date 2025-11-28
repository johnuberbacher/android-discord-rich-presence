import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, AppState, NativeModules, FlatList, TouchableOpacity, TextInput, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';

const { ForegroundAppModule } = NativeModules;

// Notification ID for persistent foreground notification
const FOREGROUND_NOTIFICATION_ID = 'foreground-service-notification';

// Store the latest notification data for restoration if dismissed
let lastNotificationData = { title: 'Hello World', body: 'Hello World', details: '' };

// Storage keys
const PACKAGES_STORAGE_KEY = '@packages_seen';
const CUSTOM_NAMES_STORAGE_KEY = '@custom_names';

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
    console.error('Error storing package:', error);
  }
};

// Function to get foreground app name and update notification
const updateNotificationWithForegroundApp = async () => {
  try {
    if (ForegroundAppModule) {
      const result = await ForegroundAppModule.getForegroundAppName();
      // Parse debug info: appName|packageName|method|debugInfo
      const parts = result.split('|');
      const appName = parts[0] || 'null';
      const packageName = parts[1] || 'unknown';
      const method = parts[2] || 'unknown';
      const debugInfo = parts[3] || '';
      
      // Store the package
      if (packageName !== 'unknown' && packageName !== 'null') {
        await storePackage(packageName);
      }
      
      // Get custom display name
      const displayName = await getDisplayName(packageName);
      
      // Show in notification
      const title = displayName;
      const body = packageName;
      
      await updateForegroundNotification(title, body);
    } else {
      await updateForegroundNotification('null', 'Module not available');
    }
  } catch (error) {
    console.error('Error getting foreground app:', error);
    await updateForegroundNotification('null', `Error: ${error.message}`);
  }
};

// Function to update notification with dynamic strings
// Export this so you can call it from anywhere in your app to update the notification
export const updateForegroundNotification = async (title = 'Hello World', body = 'Hello World', details = '') => {
  // Store the latest notification data for restoration if dismissed
  lastNotificationData = { title, body, details };
  // Create a channel (required for Android)
  const channelId = await notifee.createChannel({
    id: 'foreground-service',
    name: 'Foreground Service',
    importance: AndroidImportance.LOW, // Lower importance - only shows in notification panel
  });

  // Display notification as foreground service (but not persistent on screen)
  await notifee.displayNotification({
    id: FOREGROUND_NOTIFICATION_ID,
    title: title,
    body: body + (details ? ` - ${details}` : ''),
    android: {
      channelId,
      asForegroundService: true, // Required for foreground service to keep running
      ongoing: false, // Allows dismissal, won't stay on screen persistently
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
  const [packages, setPackages] = useState([]);
  const [editingPackage, setEditingPackage] = useState(null);
  const [editText, setEditText] = useState('');
  const [customNames, setCustomNames] = useState({});

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
              console.warn('PACKAGE_USAGE_STATS permission not granted. Please enable it in Settings > Apps > Special app access > Usage access');
              // Optionally open settings automatically
              // await ForegroundAppModule.openUsageStatsSettings();
            }
          } catch (error) {
            console.error('Error checking usage stats permission:', error);
          }
        }
        // Start with default "null" since we're not in background yet
        await updateForegroundNotification('null', 'null');
      }
    };

    startForegroundService();

    // Load packages and custom names on startup
    const loadPackages = async () => {
      try {
        const packagesJson = await AsyncStorage.getItem(PACKAGES_STORAGE_KEY);
        const loadedPackages = packagesJson ? JSON.parse(packagesJson) : [];
        setPackages(loadedPackages);
        
        const customNamesJson = await AsyncStorage.getItem(CUSTOM_NAMES_STORAGE_KEY);
        const loadedCustomNames = customNamesJson ? JSON.parse(customNamesJson) : {};
        setCustomNames(loadedCustomNames);
      } catch (error) {
        console.error('Error loading packages:', error);
      }
    };

    loadPackages();

    // Reload packages periodically when app is active
    packagesReloadIntervalRef.current = setInterval(() => {
      if (AppState.currentState === 'active') {
        loadPackages();
      }
    }, 2000);

    // Function to restore notification if it was dismissed
    const restoreNotification = async () => {
      try {
        const { title, body, details } = lastNotificationData;
        await updateForegroundNotification(title, body, details);
      } catch (error) {
        console.error('Error restoring notification:', error);
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
          await updateNotificationWithForegroundApp();
        }
      } catch (error) {
        console.error('Error checking notification:', error);
      }
    };

    // Listen to app state changes
    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      // When app enters background, update notification with foreground app name
      if (nextAppState === 'background') {
        updateNotificationWithForegroundApp();
      } else if (nextAppState === 'active') {
        // Reload packages when app comes to foreground
        loadPackages();
      }
    });

    // Update notification periodically when in background (every 1 second)
    notificationIntervalRef.current = setInterval(() => {
      if (AppState.currentState === 'background') {
        updateNotificationWithForegroundApp();
      }
    }, 1000);

    // Cleanup: stop foreground service when component unmounts
    return () => {
      if (notificationIntervalRef.current) {
        clearInterval(notificationIntervalRef.current);
      }
      if (packagesReloadIntervalRef.current) {
        clearInterval(packagesReloadIntervalRef.current);
      }
      appStateSubscription.remove();
      notifee.stopForegroundService();
    };
  }, []);

  const handleEditPackage = (packageName) => {
    setEditingPackage(packageName);
    setEditText(customNames[packageName] || packageName);
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
      
      await AsyncStorage.setItem(CUSTOM_NAMES_STORAGE_KEY, JSON.stringify(newCustomNames));
      setCustomNames(newCustomNames);
      setEditingPackage(null);
      setEditText('');
    } catch (error) {
      console.error('Error saving custom name:', error);
    }
  };

  const getDisplayNameForList = (packageName) => {
    return customNames[packageName] || packageName;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Detected Apps</Text>
      {packages.length === 0 ? (
        <Text style={styles.emptyText}>No apps detected yet. Switch to another app to see it here.</Text>
      ) : (
        <FlatList
          data={packages}
          keyExtractor={(item) => item}
          style={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.packageItem}
              onPress={() => handleEditPackage(item)}
            >
              <Text style={styles.packageName}>{getDisplayNameForList(item)}</Text>
              <Text style={styles.packageId}>{item}</Text>
            </TouchableOpacity>
          )}
        />
      )}
      
      <Modal
        visible={editingPackage !== null}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setEditingPackage(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit App Name</Text>
            <Text style={styles.modalPackageId}>{editingPackage}</Text>
            <TextInput
              style={styles.textInput}
              value={editText}
              onChangeText={setEditText}
              placeholder="Enter custom name"
              autoFocus={true}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={() => {
                  setEditingPackage(null);
                  setEditText('');
                }}
              >
                <Text style={[styles.buttonText, { color: '#333' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.saveButton]}
                onPress={saveCustomName}
              >
                <Text style={[styles.buttonText, { color: '#fff' }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginTop: 50,
  },
  list: {
    flex: 1,
  },
  packageItem: {
    backgroundColor: '#f5f5f5',
    padding: 15,
    marginBottom: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  packageName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 5,
  },
  packageId: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '80%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  modalPackageId: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
    marginBottom: 15,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  button: {
    padding: 12,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#e0e0e0',
  },
  saveButton: {
    backgroundColor: '#007AFF',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
