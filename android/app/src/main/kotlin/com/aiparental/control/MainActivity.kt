package com.aiparental.control

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_LOCK = "lock"
        const val EXTRA_TARGET = "target"
        private const val REQ_MIC = 42
    }

    private lateinit var webView: WebView
    private var lockMode = false
    private var targetPkg = ""

    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    private var speechLang = "ru-RU"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        readIntent(intent)

        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = true
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(Bridge(), "Android")
        webView.loadUrl("file:///android_asset/www/index.html")
        setContentView(webView)
    }

    private fun readIntent(i: Intent?) {
        lockMode = i?.getBooleanExtra(EXTRA_LOCK, false) ?: false
        targetPkg = i?.getStringExtra(EXTRA_TARGET) ?: ""
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        readIntent(intent)
        js("window.onAppIntent && window.onAppIntent()")
    }

    override fun onResume() {
        super.onResume()
        js("window.onAppResume && window.onAppResume()")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        js("window.onBack && window.onBack()")
    }

    override fun onDestroy() {
        recognizer?.destroy()
        recognizer = null
        super.onDestroy()
    }

    private fun js(code: String) {
        runOnUiThread {
            if (::webView.isInitialized) webView.evaluateJavascript(code, null)
        }
    }

    private fun goHome() {
        val home = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(home)
    }

    private fun isAccessibilityOn(): Boolean {
        val expected = ComponentName(this, LockService::class.java).flattenToString()
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
    }

    // ---------- Распознавание речи (непрерывное) ----------

    private fun startSpeech(lang: String) {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            js("window.__speech && window.__speech('error', 'unavailable')")
            return
        }
        speechLang = lang
        listening = true
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this)
            recognizer?.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    js("window.__speech && window.__speech('ready', '')")
                }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onEvent(eventType: Int, params: Bundle?) {}

                override fun onPartialResults(partialResults: Bundle?) {
                    val list = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    val text = list?.firstOrNull() ?: return
                    js("window.__speech && window.__speech('partial', ${JSONObject.quote(text)})")
                }

                override fun onResults(results: Bundle?) {
                    val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    val text = list?.firstOrNull() ?: ""
                    js("window.__speech && window.__speech('final', ${JSONObject.quote(text)})")
                    restartIfNeeded()
                }

                override fun onError(error: Int) {
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        listening = false
                        js("window.__speech && window.__speech('error', 'permission')")
                        return
                    }
                    if (error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ||
                        error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) {
                        listening = false
                        js("window.__speech && window.__speech('error', 'language')")
                        return
                    }
                    restartIfNeeded()
                }
            })
        }
        listenOnce()
    }

    private fun listenOnce() {
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, speechLang)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, speechLang)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
        }
        try {
            recognizer?.startListening(i)
        } catch (e: Exception) {
            listening = false
            js("window.__speech && window.__speech('error', 'start')")
        }
    }

    private fun restartIfNeeded() {
        if (listening) {
            webView.postDelayed({ if (listening) listenOnce() }, 250)
        } else {
            js("window.__speech && window.__speech('end', '')")
        }
    }

    private fun stopSpeech() {
        listening = false
        recognizer?.stopListening()
        js("window.__speech && window.__speech('end', '')")
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC) {
            val ok = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            js("window.onMicPermission && window.onMicPermission($ok)")
        }
    }

    // ---------- Запрос к Claude API ----------

    private fun postClaude(apiKey: String, body: String): Pair<Int, String> {
        val conn = URL("https://api.anthropic.com/v1/messages").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 20000
            conn.readTimeout = 120000
            conn.doOutput = true
            conn.setRequestProperty("content-type", "application/json")
            conn.setRequestProperty("x-api-key", apiKey)
            conn.setRequestProperty("anthropic-version", "2023-06-01")
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = if (stream == null) "" else
                BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
            return Pair(code, text)
        } finally {
            conn.disconnect()
        }
    }

    // ---------- Мост для JavaScript ----------

    inner class Bridge {

        @JavascriptInterface
        fun load(key: String): String = Store.loadData(this@MainActivity, key)

        @JavascriptInterface
        fun save(key: String, value: String) = Store.saveData(this@MainActivity, key, value)

        @JavascriptInterface
        fun isLockMode(): Boolean = lockMode

        @JavascriptInterface
        fun getTarget(): String = targetPkg

        @JavascriptInterface
        fun getAppLabel(pkg: String): String {
            return try {
                val info = packageManager.getApplicationInfo(pkg, 0)
                packageManager.getApplicationLabel(info).toString()
            } catch (e: Exception) {
                pkg
            }
        }

        @JavascriptInterface
        fun getApps(): String {
            val main = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val list = packageManager.queryIntentActivities(main, 0)
            val seen = HashSet<String>()
            val arr = JSONArray()
            for (ri in list.sortedBy { it.loadLabel(packageManager).toString().lowercase() }) {
                val pkg = ri.activityInfo.packageName
                if (pkg == packageName || !seen.add(pkg)) continue
                val o = JSONObject()
                o.put("pkg", pkg)
                o.put("name", ri.loadLabel(packageManager).toString())
                arr.put(o)
            }
            return arr.toString()
        }

        @JavascriptInterface
        fun getBlocked(): String = JSONArray(Store.getBlocked(this@MainActivity).toList()).toString()

        @JavascriptInterface
        fun setBlocked(json: String) {
            val arr = JSONArray(json)
            val set = HashSet<String>()
            for (i in 0 until arr.length()) set.add(arr.getString(i))
            Store.setBlocked(this@MainActivity, set)
        }

        @JavascriptInterface
        fun getUnlockUntil(): String = Store.getUnlockUntil(this@MainActivity).toString()

        @JavascriptInterface
        fun grantMinutes(minutes: Int) {
            val now = System.currentTimeMillis()
            val base = maxOf(now, Store.getUnlockUntil(this@MainActivity))
            Store.setUnlockUntil(this@MainActivity, base + minutes * 60_000L)
        }

        @JavascriptInterface
        fun lockNow() {
            Store.setUnlockUntil(this@MainActivity, 0L)
        }

        @JavascriptInterface
        fun setParentMinutes(minutes: Int) {
            val until = if (minutes <= 0) 0L else System.currentTimeMillis() + minutes * 60_000L
            Store.setParentUntil(this@MainActivity, until)
        }

        @JavascriptInterface
        fun getProtect(): Boolean = Store.getProtect(this@MainActivity)

        @JavascriptInterface
        fun setProtect(value: Boolean) = Store.setProtect(this@MainActivity, value)

        @JavascriptInterface
        fun getEnabled(): Boolean = Store.getEnabled(this@MainActivity)

        @JavascriptInterface
        fun setEnabled(value: Boolean) = Store.setEnabled(this@MainActivity, value)

        @JavascriptInterface
        fun isAccessibilityOn(): Boolean = this@MainActivity.isAccessibilityOn()

        @JavascriptInterface
        fun openAccessibilitySettings() {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }

        @JavascriptInterface
        fun openAppInfo() {
            val i = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
            startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }

        @JavascriptInterface
        fun openTarget() {
            runOnUiThread {
                val pkg = targetPkg
                lockMode = false
                targetPkg = ""
                val launch = if (pkg.isNotEmpty()) packageManager.getLaunchIntentForPackage(pkg) else null
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(launch)
                } else {
                    goHome()
                }
            }
        }

        @JavascriptInterface
        fun goHome() {
            runOnUiThread { this@MainActivity.goHome() }
        }

        @JavascriptInterface
        fun exitApp() {
            runOnUiThread { finish() }
        }

        @JavascriptInterface
        fun toast(msg: String) {
            runOnUiThread { Toast.makeText(this@MainActivity, msg, Toast.LENGTH_SHORT).show() }
        }

        @JavascriptInterface
        fun hasMic(): Boolean =
            ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

        @JavascriptInterface
        fun requestMic() {
            runOnUiThread {
                ActivityCompat.requestPermissions(this@MainActivity, arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            }
        }

        @JavascriptInterface
        fun speechAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(this@MainActivity)

        @JavascriptInterface
        fun startListening(lang: String) {
            runOnUiThread { startSpeech(lang) }
        }

        @JavascriptInterface
        fun stopListening() {
            runOnUiThread { stopSpeech() }
        }

        @JavascriptInterface
        fun callClaude(id: Int, apiKey: String, body: String) {
            Thread {
                val payload: String = try {
                    val (code, text) = postClaude(apiKey, body)
                    JSONObject().put("status", code).put("body", text).toString()
                } catch (e: Exception) {
                    JSONObject().put("status", 0).put("body", e.toString()).toString()
                }
                js("window.__claudeCb && window.__claudeCb($id, ${JSONObject.quote(payload)})")
            }.start()
        }
    }
}
