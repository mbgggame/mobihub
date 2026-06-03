import admin from 'firebase-admin'

let app = null

export function initFirebase() {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}')
    if (!serviceAccount.project_id) {
      console.log('[FIREBASE] Credenciais não configuradas')
      return
    }
    app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
    console.log('[FIREBASE] Inicializado!')
  } catch(e) {
    console.error('[FIREBASE] Erro:', e.message)
  }
}

export async function enviarPush(fcmToken, titulo, corpo) {
  if (!app || !fcmToken) return false
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title: titulo, body: corpo },
      android: { priority: 'high', notification: { sound: 'default', channelId: 'mobihub_alertas' } }
    })
    return true
  } catch(e) {
    console.error('[FIREBASE] Erro push:', e.message)
    return false
  }
}

export async function enviarPushVarios(fcmTokens, titulo, corpo) {
  if (!app || !fcmTokens?.length) return 0
  try {
    const result = await admin.messaging().sendEach(
      fcmTokens.map(token => ({
        token,
        notification: { title: titulo, body: corpo },
        android: { priority: 'high', notification: { sound: 'default', channelId: 'mobihub_alertas' } }
      }))
    )
    return result.successCount
  } catch(e) {
    console.error('[FIREBASE] Erro push massa:', e.message)
    return 0
  }
}
