import { query, pool } from './db.js' 
import { getIo } from './server.js'

async function getConfig(chave) { 
  try { 
    const r = await query('SELECT valor FROM configuracoes WHERE chave = $1', [chave]) 
    return r.rows[0]?.valor 
  } catch { return null } 
} 
 
export function initScheduler() { 
  setInterval(async () => { 
    await verificarAgendamentos() 
    await verificarChegada() 
    await limparCorridasPresas() 
  }, 30 * 1000) // verifica a cada 30 segundos 
 
  console.log('[SCHEDULER] Iniciado — verifica a cada 30 segundos') 
}

async function limparCorridasPresas() {
  try {
    const result = await query(`
      UPDATE rides
      SET status = 'concluida', concluida_at = CURRENT_TIMESTAMP
      WHERE status IN ('aberta', 'aceita', 'em_andamento')
        AND created_at < NOW() - INTERVAL '4 hours'
    `);
    if (result.rowCount > 0) {
      console.log(`[SCHEDULER] Limpadas ${result.rowCount} corridas presas`);
    }
  } catch(err) {
    console.error('[SCHEDULER] Erro limparCorridasPresas:', err.message);
  }
} 
 
async function verificarAgendamentos() { 
  try { 
    const disparoImediato = await getConfig('agendamento_disparo_imediato') === 'true' 
    const minAntes = parseInt(await getConfig('agendamento_minutos_antes') || '30') 
    const agora = new Date() 
    let corridas = [] 
 
    if (disparoImediato) { 
      const result = await query(` 
        SELECT * FROM rides 
        WHERE tipo = 'agendada' 
        AND status = 'agendada' 
        AND disparada_at IS NULL 
      `) 
      corridas = result.rows 
    } else { 
      const limite = new Date(agora.getTime() + minAntes * 60 * 1000) 
      const result = await query(` 
        SELECT * FROM rides 
        WHERE tipo = 'agendada' 
        AND status = 'agendada' 
        AND disparada_at IS NULL 
        AND agendada_para <= $1 
      `, [limite.toISOString()]) 
      corridas = result.rows 
    } 
 
    for (const ride of corridas) { 
      console.log(`[SCHEDULER] Disparando corrida agendada #${ride.id}`) 
      try { 
        const { sendRideToGroup } = await import('./telegram.js') 
        const messageId = await sendRideToGroup(ride) 
        await query(` 
          UPDATE rides SET 
            status = 'aberta', 
            disparada_at = CURRENT_TIMESTAMP, 
            telegram_message_id = $1 
          WHERE id = $2 
        `, [messageId, ride.id]) 
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
    const autoAtivo = await getConfig('chegada_auto_ativo') === 'true' 
    if (!autoAtivo) return 
 
    const raioMetros = parseFloat(await getConfig('chegada_raio_metros') || '150') 
 
    // Busca corridas aceitas com localização do motorista 
    const result = await query(` 
      SELECT r.*, dl.lat as motor_lat, dl.lng as motor_lng, 
        dl.updated_at as location_updated 
      FROM rides r 
      JOIN driver_locations dl ON dl.ride_id = r.id 
      WHERE r.status = 'aceita' 
      AND r.destino_lat IS NOT NULL 
      AND dl.updated_at >= NOW() - INTERVAL '2 minutes' 
    `) 
    const corridas = result.rows 
 
    for (const ride of corridas) { 
      const distancia = calcularDistancia( 
        ride.motor_lat, ride.motor_lng, 
        ride.destino_lat, ride.destino_lng 
      ) 
 
      if (distancia <= raioMetros) { 
        console.log(`[SCHEDULER] Motorista chegou ao destino da corrida #${ride.id} (${distancia.toFixed(0)}m)`) 

        // Conclui a corrida automaticamente 
        await query(` 
          UPDATE rides SET 
            status = 'concluida', 
            concluida_at = CURRENT_TIMESTAMP, 
            concluida_auto = 1 
          WHERE id = $1 
        `, [ride.id]) 

        const io = getIo()
        if (io) {
          io.to(`ride:${ride.id}`).emit('corrida:finalizada', { rideId: ride.id, driver_id: ride.driver_id })
        }

        // Atualiza contadores 
        if (ride.driver_id) { 
          await query('UPDATE drivers SET total_viagens = total_viagens + 1 WHERE id = $1', [ride.driver_id]) 
        } 
        if (ride.client_id) { 
          await query('UPDATE clients SET total_corridas = total_corridas + 1 WHERE id = $1', [ride.client_id]) 
        } 

        // Notifica motorista para avaliar 
        try { 
          const { notifyDriverRateClient, editGroupMessage } = await import('./telegram.js') 
          const driverResult = await query('SELECT * FROM drivers WHERE id = $1', [ride.driver_id]) 
          const driver = driverResult.rows[0] 
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
