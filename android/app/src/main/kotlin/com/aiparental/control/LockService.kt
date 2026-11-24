package com.aiparental.control

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent

/**
 * Служба специальных возможностей: следит, какое приложение сейчас открыто,
 * и показывает экран с заданием, если приложение заблокировано.
 */
class LockService : AccessibilityService() {

    private val handler = Handler(Looper.getMainLooper())
    private var currentPkg: String? = null
    private var lastLaunch = 0L

    private val ticker = object : Runnable {
        override fun run() {
            currentPkg?.let { check(it) }
            handler.postDelayed(this, 5000)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        handler.removeCallbacks(ticker)
        handler.postDelayed(ticker, 5000)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        if (isIgnored(pkg)) return
        currentPkg = pkg
        check(pkg)
    }

    private fun isIgnored(pkg: String): Boolean {
        if (pkg == "com.android.systemui") return true
        if (pkg.contains("inputmethod") || pkg.contains("keyboard")) return true
        val ime = Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD) ?: ""
        if (ime.isNotEmpty() && ime.startsWith("$pkg/")) return true
        return false
    }

    private fun shouldBlock(pkg: String): Boolean {
        if (pkg == packageName) return false
        if (!Store.getEnabled(this)) return false
        val now = System.currentTimeMillis()
        if (now < Store.getParentUntil(this)) return false
        if (Store.getProtect(this) && PROTECTED.contains(pkg)) return true
        if (Store.getBlocked(this).contains(pkg) && now >= Store.getUnlockUntil(this)) return true
        return false
    }

    private fun check(pkg: String) {
        if (!shouldBlock(pkg)) return
        val now = System.currentTimeMillis()
        if (now - lastLaunch < 1200) return
        lastLaunch = now
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(MainActivity.EXTRA_LOCK, true)
            putExtra(MainActivity.EXTRA_TARGET, pkg)
        }
        try {
            startActivity(intent)
        } catch (e: Exception) {
            performGlobalAction(GLOBAL_ACTION_HOME)
        }
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        handler.removeCallbacks(ticker)
        super.onDestroy()
    }

    companion object {
        /** Настройки и установщик блокируются в режиме защиты, чтобы ребёнок не отключил службу. */
        val PROTECTED = setOf(
            "com.android.settings",
            "com.samsung.android.settings",
            "com.miui.securitycenter",
            "com.android.packageinstaller",
            "com.google.android.packageinstaller",
            "com.samsung.android.packageinstaller"
        )
    }
}
