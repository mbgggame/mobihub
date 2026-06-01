package com.smartmob.mobihub.motorista

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.net.URL

class CpfActivity : AppCompatActivity() {

    private val PREFS_NAME = "mobihub_motorista"
    private val CPF_KEY = "motorista_cpf"
    private val TOKEN_KEY = "motorista_token"
    private val BASE_URL = "https://mobihub-s9yl.onrender.com"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_cpf)

        // Verifica se já tem token salvo — vai direto sem pedir CPF
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val tokenSalvo = prefs.getString(TOKEN_KEY, null)
        if (!tokenSalvo.isNullOrEmpty()) {
            android.util.Log.d("MobiHub", "Token já salvo, indo direto para MainActivity")
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            return
        }

        val editCpf = findViewById<EditText>(R.id.editCpf)
        val btnContinuar = findViewById<Button>(R.id.btnContinuar)
        val tvErro = findViewById<TextView>(R.id.tvErro)

        btnContinuar.text = "Continuar"

        btnContinuar.setOnClickListener {
            val cpf = editCpf.text.toString().replace(Regex("[^0-9]"), "")
            if (cpf.length != 11) {
                tvErro.text = "CPF inválido. Digite os 11 dígitos."
                tvErro.visibility = View.VISIBLE
                return@setOnClickListener
            }

            tvErro.visibility = View.GONE
            btnContinuar.isEnabled = false
            btnContinuar.text = "Verificando..."

            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putString(CPF_KEY, cpf).apply()

            Thread {
                try {
                    val url = "$BASE_URL/api/motorista/status-cadastro?cpf=$cpf"
                    android.util.Log.d("MobiHub", "Consultando URL: $url")
                    val response = URL(url).readText()
                    android.util.Log.d("MobiHub", "Resposta: $response")
                    val json = JSONObject(response)
                    val status = json.optString("status")
                    val token = json.optString("token")
                    android.util.Log.d("MobiHub", "Status: $status | Token: $token")

                    runOnUiThread {
                        if (status == "aprovado" && token.isNotEmpty() && token != "null") {
                            android.util.Log.d("MobiHub", "Salvando token: $token")
                            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                                .edit().putString(TOKEN_KEY, token).apply()
                            // Verifica se foi salvo
                            val salvo = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                                .getString(TOKEN_KEY, null)
                            android.util.Log.d("MobiHub", "Token salvo confirmado: $salvo")
                        } else {
                            android.util.Log.d("MobiHub", "Não aprovado ainda, indo para cadastro")
                        }
                        startActivity(Intent(this, MainActivity::class.java))
                        finish()
                    }
                } catch (e: Exception) {
                    android.util.Log.e("MobiHub", "Erro: ${e.message}")
                    runOnUiThread {
                        btnContinuar.isEnabled = true
                        btnContinuar.text = "Continuar"
                        tvErro.text = "Erro de conexão. Tente novamente."
                        tvErro.visibility = View.VISIBLE
                    }
                }
            }.start()
        }
    }
}
