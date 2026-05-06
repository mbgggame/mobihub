import { query, pool } from './db.js' 
import { db } from './db.js' 
 
function getConfig(chave) { 
  try { 
    const r = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) 
    return r?.valor 
  } catch { return null } 
} 
 
export function initScheduler() { 
  setInterval(async () => { 
    await verificarAgendamentos() 
    await verificarChegada() 
  }, 30 * 1000) // verifica a cada 30 segundos 
 
  console.log('[SCHEDULER] Iniciado — verifica a cada 30 segundos') 
} 
 
async function verificarAgendamentos() { 
  try { 
    const disparoImediato = getConfig('agendamento_disparo_imediato') === 'true' 
    const minAntes = parseInt(getConfig('agendamento_minutos_antes') || '30') 
    const agora = new Date() 
    let corridas = [] 
 
    if (disparoImediato) { 
      corridas = db.prepare(` 
        SELECT * FROM rides 
        WHERE tipo = 'agendada' 
        AND status = 'agendada' 
        AND disparada_at IS NULL 
      `).all() 
    } else { 
      const limite = new Date(agora.getTime() + minAntes * 60 * 1000) 
      corridas = db.prepare(` 
        SELECT * FROM rides 
        WHERE tipo = 'agendada' 
        AND status = 'agendada' 
        AND disparada_at IS NULL 
        AND agendada_para <= ? 
      `).all(limite.toISOString()) 
    } 
 
    for (const ride of corridas) { 
      console.log(`[SCHEDULER] Disparando corrida agendada #${ride.id}`) 
      try { 
        const { sendRideToGroup } = await import('./telegram.js') 
        const messageId = await sendRideToGroup(ride) 
        db.prepare(` 
          UPDATE rides SET 
            status = 'aberta', 
            disparada_at = CURRENT_TIMESTAMP, 
            telegram_message_id = ? 
          WHERE id = ? 
        `).run(messageId, ride.id) 
        console.log(`[SCHEDULER] Corrida #${ride.id} disparada`) 
      } catch(err) { 
        console.error(`[SCHEDULER] Erro ao disparar corrida #${ride.id}:`, err.message) 
      } 
    } 
  } catch(err) { 
    console.error('[SCHEDULER] Erro verificarAgendamentos:', err.message) 
  } 
} 
 
// Verifica chegada automática do motorista ao destino 
async function verificarChegada() { 
  try { 
    const autoAtivo = getConfig('chegada_auto_ativo') === 'true' 
    if (!autoAtivo) return 
 
    const raioMetros = parseFloat(getConfig('chegada_raio_metros') || '150') 
 
    // Busca corridas aceitas com localização do motorista 
    const corridas = db.prepare(` 
      SELECT r.*, dl.lat as motor_lat, dl.lng as motor_lng, 
        dl.updated_at as location_updated 
      FROM rides r 
      JOIN driver_locations dl ON dl.ride_id = r.id 
      WHERE r.status = 'aceita' 
      AND r.destino_lat IS NOT NULL 
      AND datetime(dl.updated_at) >= datetime('now', '-2 minutes') 
    `).all() 
 
    for (const ride of corridas) { 
      const distancia = calcularDistancia( 
        ride.motor_lat, ride.motor_lng, 
        ride.destino_lat, ride.destino_lng 
      ) 
 
      if (distancia <= raioMetros) { 
        console.log(`[SCHEDULER] Motorista chegou ao destino da corrida #${ride.id} (${distancia.toFixed(0)}m)`) 
 
        // Conclui a corrida automaticamente 
        db.prepare(` 
          UPDATE rides SET 
            status = 'concluida', 
            concluida_at = CURRENT_TIMESTAMP, 
            concluida_auto = 1 
          WHERE id = ? 
        `).run(ride.id) 
 
        // Atualiza contadores 
        if (ride.driver_id) { 
          db.prepare('UPDATE drivers SET total_viagens = total_viagens + 1 WHERE id = ?').run(ride.driver_id) 
        } 
        if (ride.client_id) { 
          db.prepare('UPDATE clients SET total_corridas = total_corridas + 1 WHERE id = ?').run(ride.client_id) 
        } 
 
        // Notifica motorista para avaliar 
        try { 
          const { notifyDriverRateClient, editGroupMessage } = await import('./telegram.js') 
          const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(ride.driver_id) 
          if (driver) await notifyDriverRateClient(driver, ride) 
          if (ride.telegram_message_id) { 
            await editGroupMessage( 
              ride.telegram_message_id, 
              `✅ *Corrida concluída automaticamente!*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}\n💰 R$ ${Number(ride.valor).toFixed(2)}` 
            ) 
          } 
        } catch(err) { 
          console.error('[SCHEDULER] Erro ao notificar chegada:', err.message) 
        } 
      } 
    } 
  } catch(err) { 
    console.error('[SCHEDULER] Erro verificarChegada:', err.message) 
  } 
} 
 
function calcularDistancia(lat1, lng1, lat2, lng2) { 
  const R = 6371000 // metros 
  const dLat = (lat2 - lat1) * Math.PI / 180 
  const dLng = (lng2 - lng1) * Math.PI / 180 
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng/2) * Math.sin(dLng/2) 
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) 
} 
