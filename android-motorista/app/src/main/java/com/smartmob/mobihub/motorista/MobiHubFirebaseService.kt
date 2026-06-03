package com.smartmob.mobihub.motorista

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class MobiHubFirebaseService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // Salva o token localmente para enviar ao servidor
        val prefs = getSharedPreferences("mobihub_motorista", Context.MODE_PRIVATE)
        prefs.edit().putString("fcm_token", token).apply()

        // Envia para o servidor se já tiver token de motorista
        val motoristToken = prefs.getString("motorista_token", null)
        if (motoristToken != null) {
            enviarTokenParaServidor(motoristToken, token)
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)

        val titulo = remoteMessage.notification?.title
            ?: remoteMessage.data["title"]
            ?: "MobiHub"
        val corpo = remoteMessage.notification?.body
            ?: remoteMessage.data["body"]
            ?: ""

        mostrarNotificacao(titulo, corpo)
    }

    private fun mostrarNotificacao(titulo: String, corpo: String) {
        val channelId = "mobihub_alertas"
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Alertas MobiHub",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Alertas de voos e corridas"
                enableVibration(true)
            }
            notificationManager.createNotificationChannel(channel)
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(titulo)
            .setContentText(corpo)
            .setStyle(NotificationCompat.BigTextStyle().bigText(corpo))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .build()

        notificationManager.notify(System.currentTimeMillis().toInt(), notification)
    }

    private fun enviarTokenParaServidor(motoristToken: String, fcmToken: String) {
        Thread {
            try {
                val url = java.net.URL("https://mobihub-s9yl.onrender.com/api/motorista/$motoristToken/fcm-token")
                val conn = url.openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                val body = """{"fcm_token":"$fcmToken"}"""
                conn.outputStream.write(body.toByteArray())
                conn.responseCode
                conn.disconnect()
            } catch (e: Exception) {
                android.util.Log.e("MobiHub", "Erro ao enviar FCM token: ${e.message}")
            }
        }.start()
    }
}
