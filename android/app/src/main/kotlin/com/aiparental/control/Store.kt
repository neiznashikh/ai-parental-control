package com.aiparental.control

import android.content.Context
import android.content.SharedPreferences

/** Общие настройки блокировки, которые читают и экран, и служба. */
object Store {
    private const val NAME = "apc_store"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun getBlocked(ctx: Context): Set<String> =
        prefs(ctx).getStringSet("blocked", emptySet()) ?: emptySet()

    fun setBlocked(ctx: Context, set: Set<String>) {
        prefs(ctx).edit().putStringSet("blocked", HashSet(set)).apply()
    }

    fun getUnlockUntil(ctx: Context): Long = prefs(ctx).getLong("unlockUntil", 0L)

    fun setUnlockUntil(ctx: Context, value: Long) {
        prefs(ctx).edit().putLong("unlockUntil", value).apply()
    }

    /** Пока действует режим родителя, ничего не блокируется. */
    fun getParentUntil(ctx: Context): Long = prefs(ctx).getLong("parentUntil", 0L)

    fun setParentUntil(ctx: Context, value: Long) {
        prefs(ctx).edit().putLong("parentUntil", value).apply()
    }

    fun getProtect(ctx: Context): Boolean = prefs(ctx).getBoolean("protect", false)

    fun setProtect(ctx: Context, value: Boolean) {
        prefs(ctx).edit().putBoolean("protect", value).apply()
    }

    fun getEnabled(ctx: Context): Boolean = prefs(ctx).getBoolean("enabled", true)

    fun setEnabled(ctx: Context, value: Boolean) {
        prefs(ctx).edit().putBoolean("enabled", value).apply()
    }

    /** Произвольные данные интерфейса (профиль, статистика) в виде JSON-строк. */
    fun loadData(ctx: Context, key: String): String =
        prefs(ctx).getString("data_$key", "") ?: ""

    fun saveData(ctx: Context, key: String, value: String) {
        prefs(ctx).edit().putString("data_$key", value).apply()
    }
}
