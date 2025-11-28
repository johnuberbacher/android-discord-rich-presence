package com.johnuberbacher.androiddiscordrichpresence

import android.app.ActivityManager
import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class ForegroundAppModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    
    override fun getName(): String {
        return "ForegroundAppModule"
    }

    @ReactMethod
    fun isUsageStatsPermissionGranted(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                val appOpsManager = reactApplicationContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
                val mode = appOpsManager.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    android.os.Process.myUid(),
                    reactApplicationContext.packageName
                )
                promise.resolve(mode == AppOpsManager.MODE_ALLOWED)
            } else {
                promise.resolve(false)
            }
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun openUsageStatsSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to open settings", e)
        }
    }

    @ReactMethod
    fun getForegroundAppName(promise: Promise) {
        try {
            val packageManager = reactApplicationContext.packageManager
            var appName: String? = null
            var packageName: String? = null
            var method: String = "none"
            var debugInfo: String = ""
            val myPackageName = reactApplicationContext.packageName
            
            // Helper function to get app name from package
            fun getAppNameFromPackage(pkg: String): Pair<String?, String> {
                var debugMsg = ""
                return try {
                    // Method 1: Try getApplicationLabel
                    try {
                        val appInfo = packageManager.getApplicationInfo(pkg, PackageManager.GET_META_DATA)
                        val label = packageManager.getApplicationLabel(appInfo)
                        if (label != null && label.isNotEmpty() && label.toString().trim().isNotEmpty()) {
                            return Pair(label.toString(), "label")
                        }
                        debugMsg += "label:empty;"
                    } catch (e: SecurityException) {
                        debugMsg += "labelErr:SecurityException;"
                    } catch (e: PackageManager.NameNotFoundException) {
                        debugMsg += "labelErr:NameNotFound;"
                    } catch (e: Exception) {
                        debugMsg += "labelErr:${e.javaClass.simpleName};"
                    }
                    
                    // Method 2: Try getting from launcher activity
                    try {
                        val intent = packageManager.getLaunchIntentForPackage(pkg)
                        if (intent != null) {
                            val resolveInfo = packageManager.resolveActivity(intent, PackageManager.GET_META_DATA)
                            if (resolveInfo != null && resolveInfo.activityInfo != null) {
                                val activityLabel = resolveInfo.loadLabel(packageManager)
                                if (activityLabel != null && activityLabel.isNotEmpty() && activityLabel.toString().trim().isNotEmpty()) {
                                    return Pair(activityLabel.toString(), "launcher")
                                }
                            }
                        }
                        debugMsg += "launcher:null;"
                    } catch (e: Exception) {
                        debugMsg += "launcherErr:${e.javaClass.simpleName};"
                    }
                    
                    // Method 3: Try getApplicationInfo with name
                    try {
                        val appInfo = packageManager.getApplicationInfo(pkg, PackageManager.GET_META_DATA)
                        if (appInfo.name != null && appInfo.name.isNotEmpty()) {
                            return Pair(appInfo.name, "appInfo")
                        }
                        debugMsg += "appInfo:null;"
                    } catch (e: Exception) {
                        debugMsg += "appInfoErr:${e.javaClass.simpleName};"
                    }
                    
                    Pair(null, debugMsg)
                } catch (e: Exception) {
                    Pair(null, "exception:${e.javaClass.simpleName}")
                }
            }
            
            // Filter out system packages and Google services
            val systemPackages = setOf(
                "com.android.systemui",
                "com.google.android.gms",
                "com.google.android.googlequicksearchbox",
                "com.google.android.apps.photos",
                "com.google.android.apps.docs",
                "com.google.android.apps.maps"
            )
            
            fun isSystemPackage(pkg: String?): Boolean {
                if (pkg == null) return true
                if (pkg == myPackageName) return true
                if (pkg.startsWith("android.")) return true
                if (pkg.startsWith("com.android.")) return true
                if (systemPackages.contains(pkg)) return true
                return false
            }
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                // Use UsageStatsManager (requires PACKAGE_USAGE_STATS permission)
                try {
                    val usageStatsManager = reactApplicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
                    val currentTime = System.currentTimeMillis()
                    
                    // Primary method: Use queryEvents - track foreground/background state
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        try {
                            // Query last 30 seconds to catch recent app switches
                            val events = usageStatsManager.queryEvents(currentTime - 30000, currentTime)
                            if (events != null) {
                                // Track the state of each app (foreground/background)
                                val appStates = mutableMapOf<String, Long>() // package -> last foreground time
                                var lastForegroundPackage: String? = null
                                var lastForegroundTime = 0L
                                
                                val event = UsageEvents.Event()
                                while (events.hasNextEvent()) {
                                    if (events.getNextEvent(event)) {
                                        val pkg = event.packageName
                                        if (pkg != null && !isSystemPackage(pkg)) {
                                            when (event.eventType) {
                                                UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                                                    // App moved to foreground - update its state
                                                    appStates[pkg] = event.timeStamp
                                                    // Also track the most recent one
                                                    if (event.timeStamp > lastForegroundTime) {
                                                        lastForegroundTime = event.timeStamp
                                                        lastForegroundPackage = pkg
                                                    }
                                                }
                                                UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                                                    // App moved to background - remove from foreground state
                                                    appStates.remove(pkg)
                                                }
                                            }
                                        }
                                    }
                                }
                                
                                // First, try to find an app that's currently in foreground (has MOVE_TO_FOREGROUND but no MOVE_TO_BACKGROUND)
                                if (appStates.isNotEmpty()) {
                                    val currentForegroundApp = appStates.maxByOrNull { it.value }
                                    if (currentForegroundApp != null) {
                                        packageName = currentForegroundApp.key
                                        val (name, nameMethod) = getAppNameFromPackage(packageName)
                                        appName = name
                                        if (appName == null || appName.isEmpty()) {
                                            appName = packageName
                                            method = "events-state-pkg"
                                            debugInfo = "states:${appStates.size}, nameMethod:$nameMethod"
                                        } else {
                                            method = "events-state"
                                            debugInfo = "states:${appStates.size}, nameMethod:$nameMethod"
                                        }
                                    }
                                }
                                
                                // If no app is currently tracked as foreground, use the most recent MOVE_TO_FOREGROUND
                                if (appName == null && lastForegroundPackage != null) {
                                    packageName = lastForegroundPackage
                                    val (name, nameMethod) = getAppNameFromPackage(packageName)
                                    appName = name
                                    if (appName == null || appName.isEmpty()) {
                                        appName = packageName
                                        method = "events-recent-pkg"
                                        debugInfo = "states:${appStates.size}, nameMethod:$nameMethod"
                                    } else {
                                        method = "events-recent"
                                        debugInfo = "states:${appStates.size}, nameMethod:$nameMethod"
                                    }
                                }
                                
                                if (appName == null && lastForegroundPackage != null) {
                                    // Last resort: use package name
                                    packageName = lastForegroundPackage
                                    appName = packageName
                                    method = "events-pkg-only"
                                    debugInfo = "states:${appStates.size}"
                                } else if (appName == null) {
                                    method = "events-none"
                                    debugInfo = "states:${appStates.size}, lastPkg:${lastForegroundPackage ?: "null"}"
                                }
                            }
                        } catch (e: Exception) {
                            // queryEvents failed, fall through to queryUsageStats
                        }
                    }
                    
                    // Fallback: Use queryUsageStats if queryEvents didn't find anything
                    if (appName == null) {
                        val lookbackTime = 30000L // 30 seconds lookback
                        val stats = usageStatsManager.queryUsageStats(
                            UsageStatsManager.INTERVAL_BEST,
                            currentTime - lookbackTime,
                            currentTime
                        )
                        
                        if (stats != null && stats.isNotEmpty()) {
                            // Filter out system packages
                            val filteredStats = stats.filter { 
                                !isSystemPackage(it.packageName)
                            }
                            
                            if (filteredStats.isNotEmpty()) {
                                // Find the app with the most recent lastTimeUsed
                                val recentThreshold = currentTime - 5000 // Last 5 seconds
                                val recentStats = filteredStats.filter { 
                                    it.lastTimeUsed >= recentThreshold 
                                }
                                
                                val foregroundApp = if (recentStats.isNotEmpty()) {
                                    recentStats.maxByOrNull { it.lastTimeUsed }
                                } else {
                                    filteredStats.maxByOrNull { it.lastTimeUsed }
                                }
                                
                                if (foregroundApp != null) {
                                    packageName = foregroundApp.packageName
                                    val (name, nameMethod) = getAppNameFromPackage(packageName)
                                    appName = name
                                    if (appName == null || appName.isEmpty()) {
                                        appName = packageName
                                        method = "stats-pkg"
                                        debugInfo = "total:${stats.size}, nameMethod:$nameMethod"
                                    } else {
                                        method = "stats"
                                        debugInfo = "total:${stats.size}, nameMethod:$nameMethod"
                                    }
                                } else {
                                    method = "stats-none"
                                    debugInfo = "total:${stats.size}, filtered:${filteredStats.size}"
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    // UsageStatsManager not available or permission not granted
                    promise.resolve("null")
                    return
                }
            }
            
            // Return debug info: appName|packageName|method|debugInfo
            val result = if (appName != null) {
                "${appName}|${packageName ?: "unknown"}|${method}|${debugInfo}"
            } else {
                "null|null|${method}|${debugInfo}"
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.resolve("null|null|error|${e.message ?: "unknown error"}")
        }
    }
}

