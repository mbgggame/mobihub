package com.smartmob.mobihub.motorista

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.smartmob.mobihub.motorista.databinding.ActivityMainBinding
import org.json.JSONObject
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val LOCATION_PERMISSION_REQUEST_CODE = 100
    private val FILE_CHOOSER_REQUEST_CODE = 200
    private val PREFS_NAME = "mobihub_motorista"
    private val TOKEN_KEY = "motorista_token"
    private val CPF_KEY = "motorista_cpf"
    private val BASE_URL = "https://mobihub-s9yl.onrender.com"
    private val handler = Handler(Looper.getMainLooper())
    private var pollingRunnable: Runnable? = null
    private var isApproved = false
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setupWebView()
        checkLocationPermission()

        val token = getSavedToken()
        val cpf = getSavedCpf()

        when {
            token != null -> {
                // Token salvo — abre direto no painel
                isApproved = true
                binding.webView.loadUrl("$BASE_URL/motorista/$token?app=motorista")
            }
            cpf != null -> {
                // Tem CPF mas sem token — verifica aprovação agora antes de mostrar qualquer tela
                binding.webView.loadUrl("about:blank")
                Thread {
                    try {
                        val response = URL("$BASE_URL/api/motorista/status-cadastro?cpf=$cpf").readText()
                        val json = JSONObject(response)
                        val status = json.optString("status")
                        val tokenApi = json.optString("token")
                        handler.post {
                            if (status == "aprovado" && tokenApi.isNotEmpty() && tokenApi != "null") {
                                saveToken(tokenApi)
                                isApproved = true
                                binding.webView.loadUrl("$BASE_URL/motorista/$tokenApi")
                            } else {
                                binding.webView.loadUrl("$BASE_URL/quero-dirigir?app=motorista")
                                startPolling()
                            }
                        }
                    } catch (e: Exception) {
                        handler.post {
                            binding.webView.loadUrl("$BASE_URL/quero-dirigir?app=motorista")
                            startPolling()
                        }
                    }
                }.start()
            }
            else -> {
                // Sem CPF — volta para tela de CPF
                startActivity(Intent(this, CpfActivity::class.java))
                finish()
            }
        }
    }

    private fun setupWebView() {
        val webView = binding.webView
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                if (url == null) return false
                // Abre Waze, Google Maps e outros apps externos
                return if (url.startsWith("https://waze.com") ||
                           url.startsWith("https://www.google.com/maps") ||
                           url.startsWith("intent://") ||
                           url.startsWith("geo:")) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))
                        startActivity(intent)
                    } catch (e: Exception) {
                        // App não instalado — abre no browser
                        val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))
                        intent.setPackage("com.android.chrome")
                        startActivity(intent)
                    }
                    true
                } else {
                    false
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // Detecta se está na página de cadastro e extrai CPF via JS
                if (url != null && url.contains("quero-dirigir") && !isApproved) {
                    startPollingAfterDelay()
                }
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback
                
                // Salva estado do formulário antes de abrir seletor
                webView?.evaluateJavascript(
                    "if(window.salvarEstadoFormulario) window.salvarEstadoFormulario();",
                    null
                )
                
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "application/pdf"))
                }
                startActivityForResult(
                    Intent.createChooser(intent, "Selecionar arquivo"),
                    FILE_CHOOSER_REQUEST_CODE
                )
                return true
            }
        }
        // Interface JS para capturar CPF do formulário
        webView.addJavascriptInterface(object : Any() {
            @android.webkit.JavascriptInterface
            fun salvarCpf(cpf: String) {
                if (cpf.isNotEmpty()) {
                    saveCpf(cpf)
                    startPolling()
                }
            }
        }, "AndroidBridge")
    }

    private fun startPollingAfterDelay() {
        // Injeta JS para capturar CPF quando o usuário preencher o formulário
        handler.postDelayed({
            binding.webView.evaluateJavascript("""
                (function() {
                    var cpfField = document.querySelector('input[name="cpf"], input[id="cpf"], input[placeholder*="CPF"]');
                    if (cpfField) {
                        cpfField.addEventListener('blur', function() {
                            if (this.value.length >= 11) {
                                AndroidBridge.salvarCpf(this.value.replace(/\D/g, ''));
                            }
                        });
                    }
                })();
            """.trimIndent(), null)
        }, 2000)
    }

    private fun startPolling() {
        stopPolling()
        pollingRunnable = object : Runnable {
            override fun run() {
                if (!isApproved) {
                    checkApprovalStatus()
                    handler.postDelayed(this, 15000) // verifica a cada 15 segundos
                }
            }
        }
        handler.post(pollingRunnable!!)
    }

    private fun stopPolling() {
        pollingRunnable?.let { handler.removeCallbacks(it) }
        pollingRunnable = null
    }

    private fun checkApprovalStatus() {
        val cpf = getSavedCpf() ?: return
        Thread {
            try {
                val response = URL("$BASE_URL/api/motorista/status-cadastro?cpf=$cpf").readText()
                val json = JSONObject(response)
                val status = json.optString("status")
                val token = json.optString("token")
                if (status == "aprovado" && token.isNotEmpty() && token != "null") {
                    saveToken(token)
                    isApproved = true
                    stopPolling()
                    handler.post {
                        binding.webView.loadUrl("$BASE_URL/motorista/$token?app=motorista")
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }.start()
    }

    private fun saveToken(token: String) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(TOKEN_KEY, token).apply()
    }

    private fun getSavedToken(): String? {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(TOKEN_KEY, null)
    }

    private fun saveCpf(cpf: String) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(CPF_KEY, cpf).apply()
    }

    private fun getSavedCpf(): String? {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(CPF_KEY, null)
    }

    override fun onDestroy() {
        super.onDestroy()
        stopPolling()
    }

    private fun checkLocationPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION),
                LOCATION_PERMISSION_REQUEST_CODE)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            val results = if (resultCode == Activity.RESULT_OK && data != null) {
                data.dataString?.let { arrayOf(Uri.parse(it)) }
            } else null
            fileUploadCallback?.onReceiveValue(results)
            fileUploadCallback = null
            
            // Restaura estado do formulário
            binding.webView.evaluateJavascript(
                "if(window.restaurarEstadoFormulario) window.restaurarEstadoFormulario();",
                null
            )
        }
    }

    override fun onBackPressed() {
        if (binding.webView.canGoBack()) {
            binding.webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}