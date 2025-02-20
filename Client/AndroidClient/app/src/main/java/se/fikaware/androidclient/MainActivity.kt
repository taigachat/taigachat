package se.fikaware.androidclient

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

const val REQUEST_MICROPHONE = 1

class MainActivity : AppCompatActivity() {
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        if (ContextCompat.checkSelfPermission(this,
                        Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {

            ActivityCompat.requestPermissions(this,
                    arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.MODIFY_AUDIO_SETTINGS, Manifest.permission.INTERNET),
                    REQUEST_MICROPHONE)
        }

        val clientPreferences = getSharedPreferences("client", Context.MODE_PRIVATE)
        WebView.setWebContentsDebuggingEnabled(clientPreferences.getBoolean("debugMode", false))

        val webView = findViewById<WebView>(R.id.main_webview)
        webView.settings.javaScriptEnabled = true
        webView.settings.databaseEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.settings.allowUniversalAccessFromFileURLs = true
        webView.settings.allowFileAccessFromFileURLs = true

        //webView.settings.setAppCacheEnabled(false);
        //webView.settings.cacheMode = WebSettings.LOAD_NO_CACHE;

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    request.grant(request.resources)
                }
            }
        }

        webView.addJavascriptInterface(object {
            @android.webkit.JavascriptInterface
            fun showNotification(poster: String, text: String) {
                Toast.makeText(this@MainActivity, "notification: $poster $text", Toast.LENGTH_SHORT).show()
            }

            @android.webkit.JavascriptInterface
            fun setDebug(state: Boolean) {
                clientPreferences.edit().putBoolean("debugMode", state).apply()
                runOnUiThread {
                    WebView.setWebContentsDebuggingEnabled(state)
                }
            }
        }, "androidApp")

        webView.loadUrl("file:///android_asset/index.html")
    }
}