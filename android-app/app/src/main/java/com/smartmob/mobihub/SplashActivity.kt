package com.smartmob.mobihub

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.smartmob.mobihub.databinding.ActivitySplashBinding

class SplashActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySplashBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySplashBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnPassageiro.setOnClickListener {
            openMainActivity("https://mobihub-s9yl.onrender.com/solicitar")
        }

        binding.btnMotorista.setOnClickListener {
            openMainActivity("https://mobihub-s9yl.onrender.com/motorista")
        }
    }

    private fun openMainActivity(url: String) {
        val intent = Intent(this, MainActivity::class.java)
        intent.putExtra("URL", url)
        startActivity(intent)
    }
}
