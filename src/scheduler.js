import { db } from './db.js' 
import { sendRideToGroup } from './telegram.js' 
 
function getConfig(chave) { 
  const r = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) 
  return r?.valor 
} 
 
export function initScheduler() { 
  setInterval(async () => { 
    try { 
      const disparoImediato = getConfig('agendamento_disparo_imediato') === 'true' 
      const minAntes = parseInt(getConfig('agendamento_minutos_antes') || '30') 
 
      const agora = new Date() 
      const limite = disparoImediato 
        ? new Date('2099-01-01') 
        : new Date(agora.getTime() + minAntes * 60 * 1000) 
 
      const corridas = db.prepare(` 
        SELECT * FROM rides 
        WHERE tipo = 'agendada' 
        AND status = 'agendada' 
        AND disparada_at IS NULL 
        AND agendada_para <= ? 
      `).all(limite.toISOString()) 
 
      for (const ride of corridas) { 
        console.log(`[SCHEDULER] Disparando corrida agendada #${ride.id}`) 
        const messageId = await sendRideToGroup(ride) 
        db.prepare(` 
          UPDATE rides SET 
            status = 'aberta', 
            disparada_at = CURRENT_TIMESTAMP, 
            telegram_message_id = ? 
          WHERE id = ? 
        `).run(messageId, ride.id) 
        console.log(`[SCHEDULER] Corrida #${ride.id} disparada`) 
      } 
    } catch(err) { 
      console.error('[SCHEDULER] Erro:', err.message) 
    } 
  }, 60 * 1000) 
 
  console.log('[SCHEDULER] Iniciado') 
} 
