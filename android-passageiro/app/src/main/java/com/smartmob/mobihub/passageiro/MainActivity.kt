package com.smartmob.mobihub.passageiro

import android.Manifest
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.smartmob.mobihub.passageiro.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val BASE_URL = "https://mobihub-s9yl.onrender.com"
    private val LOCATION_PERMISSION_REQUEST_CODE = 1001
    private var locationManager: LocationManager? = null
    private var gpsStarted = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setupWebView()
        solicitarPermissoes()
    }

    private fun setupWebView() {
        binding.webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = false
            setGeolocationEnabled(true)
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(binding.webView, true)
        }
        binding.webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
                callback?.invoke(origin, true, true)
            }
            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.grant(request.resources)
            }
        }
        binding.webView.webViewClient = WebViewClient()
        binding.webView.loadUrl("$BASE_URL/solicitar")
    }

    private fun solicitarPermissoes() {
        val permissoes = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissoes.add(Manifest.permission.ACCESS_FINE_LOCATION)
            permissoes.add(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissoes.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (permissoes.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissoes.toTypedArray(), LOCATION_PERMISSION_REQUEST_CODE)
        } else {
            iniciarGPS()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == LOCATION_PERMISSION_REQUEST_CODE) {
            iniciarGPS()
        }
    }

    private fun iniciarGPS() {
        if (gpsStarted) return
        gpsStarted = true
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return
        }
        locationManager = getSystemService(LOCATION_SERVICE) as LocationManager
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                val lat = location.latitude
                val lng = location.longitude
                android.util.Log.d("MobiHub", "[GPS] lat=$lat lng=$lng")
                binding.webView.post {
                    binding.webView.evaluateJavascript(
                        "if(window.receberLocalizacaoNativa) window.receberLocalizacaoNativa($lat, $lng);",
                        null
                    )
                }
            }
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
        }
        try {
            val providers = locationManager?.getProviders(true) ?: emptyList()
            android.util.Log.d("MobiHub", "[GPS] Providers disponíveis: $providers")
            if (locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true) {
                locationManager?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 3000, 5f, listener)
            }
            if (locationManager?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) == true) {
                locationManager?.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 3000, 5f, listener)
            }
            // Tenta localização imediata com último local conhecido
            val lastGps = locationManager?.getLastKnownLocation(LocationManager.GPS_PROVIDER)
            val lastNet = locationManager?.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            val lastLoc = lastGps ?: lastNet
            if (lastLoc != null) {
                android.util.Log.d("MobiHub", "[GPS] Último local: ${lastLoc.latitude}, ${lastLoc.longitude}")
                binding.webView.post {
                    binding.webView.evaluateJavascript(
                        "if(window.receberLocalizacaoNativa) window.receberLocalizacaoNativa(${lastLoc.latitude}, ${lastLoc.longitude});",
                        null
                    )
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("MobiHub", "[GPS] Erro: ${e.message}")
        }
    }

    override fun onBackPressed() {
        if (binding.webView.canGoBack()) binding.webView.goBack()
        else super.onBackPressed()
    }
}