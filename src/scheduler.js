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
    await verificarNaoComparecimento()
    await verificarChegada()
  }, 30 * 1000) // verifica a cada 30 segundos

  console.log('[SCHEDULER] Iniciado — verifica a cada 30 segundos')
} 
 
async function verificarAgendamentos() { 
  try { 
    const agora = new Date() 
    const io = getIo() 

    // 1. Notificar motoristas via socket sobre novos agendamentos disponíveis (sinal pago, sem motorista) 
    const disponiveis = (await query(` 
      SELECT COUNT(*) as total FROM rides 
      WHERE tipo = 'agendada' 
      AND status = 'agendada' 
      AND sinal_pago = true 
      AND driver_id IS NULL 
      AND agendada_para > NOW() 
    `)).rows[0] 

    if (parseInt(disponiveis.total) > 0 && io) { 
      io.emit('agendamentos:atualizar', { count: parseInt(disponiveis.total) }) 
    } 

    // 2. Alertar 30 minutos antes para corridas aceitas 
    const limite31min = new Date(agora.getTime() + 31 * 60 * 1000) 
    const limite29min = new Date(agora.getTime() + 29 * 60 * 1000) 

    const proximasCorreidas = (await query(` 
      SELECT r.*, d.nome as driver_nome, d.id as driver_id_val, 
             c.nome as client_nome 
      FROM rides r 
      LEFT JOIN drivers d ON r.driver_id = d.id 
      LEFT JOIN clients c ON r.client_id = c.id 
      WHERE r.tipo = 'agendada' 
      AND r.status = 'agendada_aceita' 
      AND r.alerta_30min_enviado IS NULL 
      AND r.agendada_para <= $1 
      AND r.agendada_para >= $2 
    `, [limite31min.toISOString(), limite29min.toISOString()])).rows 

    for (const ride of proximasCorreidas) { 
      console.log(`[SCHEDULER] Alerta 30min corrida agendada #${ride.id}`) 
      
      if (io) { 
        io.to(`motorista:${ride.driver_id_val}`).emit('agendamento:alerta_30min', { 
          rideId: ride.id, 
          token: ride.token, 
          mensagem: '⏰ Sua corrida agendada começa em 30 minutos! Confirme sua presença.', 
          origem: ride.origem, 
          destino: ride.destino, 
          agendada_para: ride.agendada_para 
        }) 
        
        io.to(`ride:${ride.id}`).emit('agendamento:alerta_30min', { 
          rideId: ride.id, 
          mensagem: '⏰ Seu motorista chega em 30 minutos!', 
          driver_nome: ride.driver_nome, 
          agendada_para: ride.agendada_para 
        }) 
      } 

      await query('UPDATE rides SET alerta_30min_enviado = CURRENT_TIMESTAMP WHERE id = $1', [ride.id]) 
    } 

  } catch(err) { 
    console.error('[SCHEDULER] Erro verificarAgendamentos:', err.message) 
  } 
} 
 
// Detecta automaticamente motoristas que não confirmaram presença 5min após o alerta de 30min
async function verificarNaoComparecimento() {
  try {
    const result = await query(`
      SELECT r.*, d.id as driver_id_val
      FROM rides r
      LEFT JOIN drivers d ON r.driver_id = d.id
      WHERE r.tipo = 'agendada'
        AND r.status = 'agendada_aceita'
        AND r.alerta_30min_enviado IS NOT NULL
        AND r.confirmou_presenca IS NULL
        AND r.alerta_30min_enviado < NOW() - INTERVAL '5 minutes'
    `)

    for (const ride of result.rows) {
      console.log(`[SCHEDULER] Motorista não confirmou presença corrida agendada #${ride.id}`)

      // Aumenta TC do motorista
      if (ride.driver_id) {
        await query('UPDATE drivers SET total_cancelamentos = total_cancelamentos + 1 WHERE id = $1', [ride.driver_id])
        const stats = (await query(`
          SELECT COUNT(*) as total,
            SUM(CASE WHEN status = 'cancelada' THEN 1 ELSE 0 END) as cancels
          FROM rides WHERE driver_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
        `, [ride.driver_id])).rows[0]
        const tc = parseFloat(stats.total) > 0 ? parseFloat((parseFloat(stats.cancels) / parseFloat(stats.total) * 100).toFixed(1)) : 0
        await query('UPDATE drivers SET tc_percentual = $1, tc_ultima_atualizacao = NOW() WHERE id = $2', [tc, ride.driver_id])
      }

      // Reabre a corrida excluindo motorista que não confirmou
      await query(`
        UPDATE rides SET
          status = 'agendada',
          driver_id = NULL,
          aceita_at = NULL,
          alerta_30min_enviado = NULL,
          confirmou_presenca = NULL,
          cancelado_por_driver_id = $1
        WHERE id = $2
      `, [ride.driver_id, ride.id])

      const io = getIo()
      if (io) {
        // Notifica passageiro
        io.to(`ride:${ride.id}`).emit('agendamento:buscando_motorista', {
          rideId: ride.id,
          mensagem: 'O motorista não confirmou presença. Buscando outro motorista...'
        })
        // Atualiza badge para todos motoristas
        const disponiveis = (await query(`
          SELECT COUNT(*) as total FROM rides
          WHERE tipo = 'agendada' AND status = 'agendada'
          AND sinal_pago = true AND driver_id IS NULL AND agendada_para > NOW()
        `)).rows[0]
        io.emit('agendamentos:atualizar', { count: parseInt(disponiveis.total) })
      }
    }
  } catch (err) {
    console.error('[SCHEDULER] Erro verificarNaoComparecimento:', err.message)
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
          io.to(`ride:${ride.id}`).emit('corrida:concluida', { rideId: ride.id, driver_id: ride.driver_id })
        }

        // Atualiza contadores 
        if (ride.driver_id) { 
          await query('UPDATE drivers SET total_viagens = total_viagens + 1 WHERE id = $1', [ride.driver_id]) 
        } 
        if (ride.client_id) { 
          await query('UPDATE clients SET total_corridas = total_corridas + 1 WHERE id = $1', [ride.client_id]) 
        } 

        // telegram removido 
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
