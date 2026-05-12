import { query } from './db.js' 

export async function dispararWebhook(evento, payload) { 
  try { 
    const webhooks = (await query( 
      "SELECT * FROM webhooks WHERE evento = $1 AND ativo = 1", 
      [evento] 
    )).rows 

    for (const wh of webhooks) { 
      const body = JSON.stringify({ 
        evento, 
        timestamp: new Date().toISOString(), 
        data: payload 
      }) 

      let statusCode = 0 
      let resposta = '' 

      try { 
        const r = await fetch(wh.url, { 
          method: 'POST', 
          headers: { 
            'Content-Type': 'application/json', 
            'X-MobiHub-Event': evento, 
            'X-MobiHub-Secret': wh.secret_key || '' 
          }, 
          body, 
          signal: AbortSignal.timeout(10000) 
        }) 
        statusCode = r.status 
        resposta = await r.text() 
      } catch(e) { 
        resposta = e.message 
        statusCode = 0 
      } 

      // Salva log 
      await query( 
        `INSERT INTO webhook_logs (webhook_id, evento, payload, resposta, status_code) 
         VALUES ($1, $2, $3, $4, $5)`, 
        [wh.id, evento, body, resposta.substring(0, 500), statusCode] 
      ).catch(() => {}) 

      console.log(`[WEBHOOK] ${evento} → ${wh.url} | Status: ${statusCode}`) 
    } 
  } catch(e) { 
    console.error('[WEBHOOK] Erro ao disparar:', e.message) 
  } 
} 
