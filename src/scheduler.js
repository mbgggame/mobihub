import { query, pool } from './db.js' 
import { getIo } from './server.js'
import { enviarPush, enviarPushVarios } from './firebase.js'

const AEROAPI_BASE  = 'https://aeroapi.flightaware.com/aeroapi';
const API_KEY       = process.env.FLIGHTAWARE_API_KEY;
const AIRPORT       = 'SBVT';
const TAXA_OCUPACAO = 0.82;

async function getConfig(chave) { 
  try { 
    const r = await query('SELECT valor FROM configuracoes WHERE chave = $1', [chave]) 
    return r.rows[0]?.valor 
  } catch { return null } 
} 
 
async function bloquearCorridasProximasAgendamento() { 
  try { 
    const agora = new Date() 
    const em90min = new Date(agora.getTime() + 90 * 60 * 1000) 
    const em60min = new Date(agora.getTime() + 60 * 60 * 1000) 
 
    const agendamentos = (await query(` 
      SELECT r.driver_id, r.id, r.agendada_para 
      FROM rides r 
      WHERE r.tipo = 'agendada' 
      AND r.status = 'agendada_aceita' 
      AND r.agendada_para AT TIME ZONE 'America/Sao_Paulo' <= $1 
      AND r.agendada_para AT TIME ZONE 'America/Sao_Paulo' >= $2 
      AND r.driver_id IS NOT NULL 
    `, [em90min.toISOString(), em60min.toISOString()])).rows 
 
    for (const ag of agendamentos) { 
      await query(` 
        UPDATE drivers 
        SET bloqueado_agendamento = true, 
            bloqueado_agendamento_ate = $1 
        WHERE id = $2 
        AND (bloqueado_agendamento IS NULL OR bloqueado_agendamento = false) 
      `, [ag.agendada_para, ag.driver_id]) 
 
      console.log(`[SCHEDULER] Motorista #${ag.driver_id} bloqueado para corridas comuns — agendamento #${ag.id} em ${ag.agendada_para}`) 
    } 
  } catch(err) { 
    console.error('[SCHEDULER] Erro bloquearCorridasProximasAgendamento:', err.message) 
  } 
}

export function initScheduler() {
  setInterval(async () => {
    await verificarAgendamentos()
    await verificarNaoComparecimento()
    await verificarChegada()
    await verificarAlertaVoo()
    await bloquearCorridasProximasAgendamento()
  }, 30 * 1000) // verifica a cada 30 segundos

  // Verifica se radar VIX em tempo real está ativado e inicia intervalo
  setInterval(async () => {
    const radarAtivo = await getConfig('radar_vix_tempo_real') === 'true'
    if (radarAtivo) {
      await verificarRadarVIXRealTime()
    }
  }, 10 * 60 * 1000) // verifica a cada 10 minutos

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

    // 2. Alertar 60 minutos antes para corridas aceitas 
    const limite61min = new Date(agora.getTime() + 61 * 60 * 1000) 
    const limite59min = new Date(agora.getTime() + 59 * 60 * 1000) 
 
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
    `, [limite61min.toISOString(), limite59min.toISOString()])).rows 

    for (const ride of proximasCorreidas) { 
      console.log(`[SCHEDULER] Alerta 30min corrida agendada #${ride.id}`) 
      
      if (io) { 
        io.to(`motorista:${ride.driver_id_val}`).emit('agendamento:alerta_30min', { 
          rideId: ride.id, 
          token: ride.token, 
          mensagem: '⏰ Sua corrida agendada começa em 60 minutos! Inicie o deslocamento.', 
          origem: ride.origem, 
          destino: ride.destino, 
          agendada_para: ride.agendada_para 
        }) 
        
        io.to(`ride:${ride.id}`).emit('agendamento:alerta_30min', { 
          rideId: ride.id, 
          mensagem: '⏰ Seu motorista está a caminho! Chegará em aproximadamente 60 minutos.', 
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

async function verificarAlertaVoo() { 
    try { 
      const agora = new Date() 
      const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000) 
      const diaSemana = brasilia.getUTCDay() 
      const em30min = new Date(brasilia.getTime() + 30 * 60 * 1000) 
      const em31min = new Date(brasilia.getTime() + 31 * 60 * 1000) 
      const ano = brasilia.getUTCFullYear()
      const mes = brasilia.getUTCMonth()
      const dia = brasilia.getUTCDate()
      
    // Busca tarifas que iniciam nos próximos 30-31 minutos 
    const tarifas = (await query('SELECT * FROM tarifas WHERE ativo = 1 ORDER BY valor_minimo DESC')).rows 
    
    for (const tarifa of tarifas) { 
      const dias = String(tarifa.dias || '').split(',').map(Number) 
      
      const tarifaAtivaNoDia = dias.includes(diaSemana) 
      if (!tarifaAtivaNoDia) continue 

      // Verifica se o horário de início está em 30-31 minutos 
      const [hInicio, mInicio] = tarifa.hora_inicio.split(':').map(Number) 
      
      const inicioDaCorrente = new Date(ano, mes, dia, hInicio, mInicio) 

      if (inicioDaCorrente >= em30min && inicioDaCorrente <= em31min) { 
        console.log(`[SCHEDULER] Alerta de voo — tarifa ${tarifa.nome} inicia às ${tarifa.hora_inicio}`) 
 
        const horaFormatada = tarifa.hora_inicio 
 
        // Busca motoristas online (com fcm_token) 
        const motoristasOnline = (await query(` 
          SELECT d.fcm_token FROM drivers d 
          JOIN driver_locations dl ON dl.driver_id = d.id 
          WHERE d.ativo = 1 AND d.fcm_token IS NOT NULL 
          AND dl.updated_at >= NOW() - INTERVAL '2 minutes' 
        `)).rows.map(r => r.fcm_token) 
 
        // Busca motoristas offline (com fcm_token) 
        const motoristasOffline = (await query(` 
          SELECT d.fcm_token FROM drivers d 
          LEFT JOIN driver_locations dl ON dl.driver_id = d.id 
          WHERE d.ativo = 1 AND d.fcm_token IS NOT NULL 
          AND (dl.updated_at IS NULL OR dl.updated_at < NOW() - INTERVAL '2 minutes') 
        `)).rows.map(r => r.fcm_token) 
 
        // Push para offline 
        if (motoristasOffline.length > 0) { 
          await enviarPushVarios( 
            motoristasOffline, 
            '✈️ Avião chegando em VIX!', 
            `Fique online! Atendimento inicia às ${horaFormatada}. Vamos embarcar passageiros!` 
          ) 
        } 
 
        // Socket para online 
        const io = getIo() 
        if (io && motoristasOnline.length > 0) { 
          io.emit('alerta:voo', { 
            mensagem: `✈️ Avião chegando em VIX — Vamos embarcar passageiros!`, 
            hora_inicio: horaFormatada, 
            tarifa_nome: tarifa.nome 
          }) 
        } 
 
        // Push também para online (reforço) 
        if (motoristasOnline.length > 0) { 
          await enviarPushVarios( 
            motoristasOnline, 
            '✈️ Avião chegando em VIX!', 
            `Vamos embarcar passageiros! Atendimento inicia às ${horaFormatada}` 
          ) 
        } 
      } 
    } 
  } catch(err) { 
    console.error('[SCHEDULER] Erro verificarAlertaVoo:', err.message) 
  } 
}

// Nova função para radar VIX em tempo real (usa AeroAPI)
async function verificarRadarVIXRealTime() {
  try {
    if (!API_KEY) {
      console.warn('[SCHEDULER] FLIGHTAWARE_API_KEY não definida — radar VIX desativado')
      return
    }

    const agora = new Date()
    const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000)
    const em30min = new Date(agora.getTime() + 30 * 60 * 1000)
    const em31min = new Date(agora.getTime() + 31 * 60 * 1000)
    const formatDate = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

    // 1. Busca voos de chegada e partida no próximo período
    const fetchFlights = async (tipo) => {
      const ep = tipo === 'chegada' ? 'arrivals' : 'departures'
      const url = `${AEROAPI_BASE}/airports/${AIRPORT}/flights/${ep}?start=${formatDate(agora)}&end=${formatDate(em31min)}&type=Airline&max_pages=3`
      const res = await fetch(url, { headers: { 'x-apikey': API_KEY } })
      if (!res.ok) throw new Error(`AeroAPI ${res.status}: ${await res.text()}`)
      const data = await res.json()
      return data.arrivals || data.departures || []
    }

    const voosChegada = await fetchFlights('chegada')
    const voosPartida = await fetchFlights('partida')

    // 2. Filtra voos que chegam/partem em 30-31 minutos
    const processarVoo = (voo, tipo) => {
      const horarioRaw = tipo === 'chegada' 
        ? (voo.estimated_in || voo.scheduled_in || voo.actual_in) 
        : (voo.estimated_out || voo.scheduled_out || voo.actual_out)
      if (!horarioRaw) return null

      const horario = new Date(horarioRaw)
      if (horario >= em30min && horario <= em31min) {
        return {
          ...voo,
          tipo,
          horario,
          horario_bsb: new Date(horario.getTime() - 3 * 60 * 60 * 1000),
          flight_id: voo.fa_flight_id
        }
      }
      return null
    }

    const voosRelevantes = [
      ...voosChegada.map(v => processarVoo(v, 'chegada')).filter(Boolean),
      ...voosPartida.map(v => processarVoo(v, 'partida')).filter(Boolean)
    ]

    if (voosRelevantes.length === 0) {
      console.log('[SCHEDULER] Radar VIX — nenhum voo relevante nos próximos 30min')
      return
    }

    console.log(`[SCHEDULER] Radar VIX — ${voosRelevantes.length} voo(s) chegando/partindo em 30min`)

    // 3. Busca motoristas online/offline para enviar notificações
    const motoristasOnline = (await query(`
      SELECT d.fcm_token FROM drivers d 
      JOIN driver_locations dl ON dl.driver_id = d.id 
      WHERE d.ativo = 1 AND d.fcm_token IS NOT NULL 
      AND dl.updated_at >= NOW() - INTERVAL '2 minutes' 
    `)).rows.map(r => r.fcm_token)

    const motoristasOffline = (await query(`
      SELECT d.fcm_token FROM drivers d 
      LEFT JOIN driver_locations dl ON dl.driver_id = d.id 
      WHERE d.ativo = 1 AND d.fcm_token IS NOT NULL 
      AND (dl.updated_at IS NULL OR dl.updated_at < NOW() - INTERVAL '2 minutes') 
    `)).rows.map(r => r.fcm_token)

    const io = getIo()

    for (const voo of voosRelevantes) {
      const tipoTexto = voo.tipo === 'chegada' ? 'Chegando' : 'Partindo'
      const horaFormatada = voo.horario_bsb.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      const mensagem = `✈️ Voo ${voo.ident} ${tipoTexto} em VIX às ${horaFormatada}!`

      // 4. Envia push para motoristas offline
      if (motoristasOffline.length > 0) {
        await enviarPushVarios(
          motoristasOffline,
          '✈️ Voo em VIX!',
          mensagem
        )
      }

      // 5. Envia socket para motoristas online
      if (io && motoristasOnline.length > 0) {
        io.emit('alerta:voo_real_time', {
          mensagem,
          voo: {
            ident: voo.ident,
            tipo: voo.tipo,
            horario_bsb: voo.horario_bsb.toISOString(),
            operator: voo.operator_friendly_name || voo.operator,
            origem_iata: voo.origin?.code_iata,
            destino_iata: voo.destination?.code_iata
          }
        })
      }

      // 6. Push também para online (reforço)
      if (motoristasOnline.length > 0) {
        await enviarPushVarios(
          motoristasOnline,
          '✈️ Voo em VIX!',
          mensagem
        )
      }
    }

    // 7. Salva voos relevantes no banco (opcional, para histórico)
    // Reutiliza getCapacity e processarVoo do script collect-vix-history
    const getCapacity = async (aircraftType) => {
      if (!aircraftType) return null
      const res = await query('SELECT max_pax FROM aircraft_capacity WHERE aircraft_type = $1', [aircraftType])
      return res.rows[0]?.max_pax || null
    }
    for (const voo of voosRelevantes) {
      const maxPax = await getCapacity(voo.aircraft_type)
      await query(`
        INSERT INTO flight_history (
          flight_id, ident, operator, operator_iata, operator_icao, 
          aircraft_type, max_pax, pax_estimado, tipo, origem_iata, 
          destino_iata, horario, horario_bsb, dia_semana, hora_slot, 
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (flight_id) DO NOTHING
      `, [
        voo.fa_flight_id, voo.ident, voo.operator_friendly_name || voo.operator, voo.operator_iata,
        voo.operator_icao, voo.aircraft_type, maxPax, maxPax ? Math.round(maxPax * TAXA_OCUPACAO) : null,
        voo.tipo, voo.origin?.code_iata, voo.destination?.code_iata,
        voo.horario.toISOString(), voo.horario_bsb.toISOString(), voo.horario_bsb.getDay(),
        voo.horario_bsb.getHours(), voo.status
      ])
    }

  } catch(err) { 
    console.error('[SCHEDULER] Erro verificarRadarVIXRealTime:', err.message) 
  } 
} 
