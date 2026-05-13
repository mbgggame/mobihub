import { query as dbQuery, pool, query } from '../db.js' 
import { requireAuth } from '../middleware/auth.js' 
import { sendRideToGroup, notifyDriverRateClient, editGroupMessage } from '../telegram.js' 
import { v4 as uuidv4 } from 'uuid' 
import { calculateInitialWaitCost, calculateStopCost, calculateTotalRideCost, calcularTempoMinutos, podeMotoristaCancel } from '../billing.js'
import { getIo } from '../server.js' 

async function getConfig() { 
  const configs = (await query('SELECT chave, valor FROM configuracoes')).rows 
  const obj = {} 
  configs.forEach(c => obj[c.chave] = c.valor) 
  return obj 
} 

async function calcularTarifa(dataHoraStr, distanciaKm) { 
  const config = await getConfig()
  const data = new Date(dataHoraStr) 
  const diaSemana = data.getDay() 
  const hora = data.getHours() 
  const minuto = data.getMinutes() 
  const horaDecimal = hora + minuto / 60 

  const resultTarifas = await dbQuery('SELECT * FROM tarifas WHERE ativo = 1') 
  const tarifas = resultTarifas.rows

  let tarifaAplicada = null 
  let maiorValor = 0 

  for (const t of tarifas) { 
    const dias = t.dias.split(',').map(Number) 
    if (!dias.includes(diaSemana)) continue 

    const [hIni, mIni] = t.hora_inicio.split(':').map(Number) 
    const [hFim, mFim] = t.hora_fim.split(':').map(Number) 
    const inicio = hIni + mIni / 60 
    const fim = hFim + mFim / 60 

    let dentro = false 
    if (inicio <= fim) { 
      dentro = horaDecimal >= inicio && horaDecimal < fim 
    } else { 
      dentro = horaDecimal >= inicio || horaDecimal < fim 
    } 

    if (dentro && t.valor_minimo > maiorValor) { 
      maiorValor = t.valor_minimo 
      tarifaAplicada = t 
    } 
  } 

  if (!tarifaAplicada) { 
    const res = await dbQuery('SELECT * FROM tarifas ORDER BY valor_minimo ASC LIMIT 1')
    tarifaAplicada = res.rows[0]
  } 

  const excedente = Math.max(0, distanciaKm - tarifaAplicada.km_minimo) 
  const valor = tarifaAplicada.valor_minimo + (excedente * tarifaAplicada.valor_km) 
  const comissaoPlataforma = parseFloat(config.comissao_plataforma || 25) / 100
  const valorMotorista = parseFloat((valor * (1 - comissaoPlataforma)).toFixed(2)) 
  const valorMobihub = parseFloat((valor * comissaoPlataforma).toFixed(2)) 

  return { 
    tarifa: tarifaAplicada.nome, 
    valor: parseFloat(valor.toFixed(2)), 
    valor_motorista: valorMotorista, 
    valor_mobihub: valorMobihub, 
    distancia_km: distanciaKm, 
    valor_minimo: tarifaAplicada.valor_minimo, 
    valor_km: tarifaAplicada.valor_km 
  } 
} 
 
export default async function ridesRoutes(fastify) { 
 
  fastify.get('/api/rides', { preHandler: requireAuth }, async (request) => { 
    const { status } = request.query 
 
    let sql = ` 
      SELECT r.*, 
        d.nome as driver_nome, d.modelo_carro, d.cor_carro, d.ano_carro, 
        d.placa, d.telefone as driver_telefone, 
        d.media_avaliacao as driver_media, d.total_viagens as driver_viagens, 
        c.telefone as client_telefone, c.nome as client_nome 
      FROM rides r 
      LEFT JOIN drivers d ON r.driver_id = d.id 
      LEFT JOIN clients c ON r.client_id = c.id 
    ` 
    const params = [] 
    if (status) { 
      sql += ' WHERE r.status = $1' 
      params.push(status) 
    } 
    sql += ' ORDER BY r.created_at DESC' 
 
    const result = await dbQuery(sql, params)
    return result.rows
  }) 
 
  fastify.post('/api/rides', async (request, reply) => { 
    const { 
      origem, origem_lat, origem_lng, 
      destino, destino_lat, destino_lng, 
      valor, client_id, tipo, agendada_para, 
      nome_cliente, telefone_cliente, forma_pagamento 
    } = request.body 
 
    if (!origem || !destino) { 
      return reply.code(400).send({ error: 'Origem e destino são obrigatórios' }) 
    } 
 
    let clientId = client_id 
 
    // Se não tem client_id mas tem telefone, busca ou cria cliente 
    if (!clientId && telefone_cliente) { 
      const existing = (await query( 
        'SELECT id FROM clients WHERE telefone = $1', [telefone_cliente] 
      )).rows[0] 
 
      if (existing) { 
        clientId = existing.id 
      } else if (nome_cliente) { 
        const novo = (await query( 
          'INSERT INTO clients (nome, telefone) VALUES ($1, $2) RETURNING id', 
          [nome_cliente, telefone_cliente] 
        )).rows[0] 
        clientId = novo.id 
      } 
    } 
 
    const token = uuidv4() 
    const statusInicial = tipo === 'agendada' ? 'agendada' : 'aberta' 
 
    const result = await dbQuery(` 
      INSERT INTO rides 
        (token, client_id, origem, origem_lat, origem_lng, destino, destino_lat, 
         destino_lng, valor, valor_motorista, valor_mobihub, tipo, agendada_para, status, forma_pagamento) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) 
      RETURNING id
    `, [token, clientId, origem, origem_lat, origem_lng, destino, 
           destino_lat, destino_lng, valor, (valor * 0.75) || null, 
           (valor * 0.25) || null, tipo || 'normal', agendada_para || null, statusInicial, forma_pagamento || '1']) 
 
    const rideId = result.rows[0].id
    const rideResult = await dbQuery('SELECT * FROM rides WHERE id = $1', [rideId]) 
    const ride = rideResult.rows[0]
 
    // Só dispara imediatamente se for corrida NORMAL 
    if (!tipo || tipo === 'normal') { 
      try { 
        const messageId = await sendRideToGroup(ride) 
        if (messageId) { 
          await query('UPDATE rides SET telegram_message_id = $1 WHERE id = $2', [messageId, ride.id]) 
        } 
      } catch (err) { 
        console.error('[RIDES] Erro ao enviar para Telegram:', err.message) 
      } 
    } 

    return { 
      id: ride.id, 
      token: ride.token, 
      link: `${process.env.BASE_URL}/r/${token}`, 
      mensagem: tipo === 'agendada' ? 'Corrida agendada com sucesso' : 'Corrida criada e enviada para o grupo Telegram' 
    } 
  }) 
 
  fastify.put('/api/rides/:id/status', { preHandler: requireAuth }, async (request, reply) => { 
    const { status } = request.body 
    const { id } = request.params 
    const statusValidos = ['aberta', 'aceita', 'concluida', 'cancelada'] 
 
    if (!statusValidos.includes(status)) { 
      return reply.code(400).send({ error: 'Status inválido' }) 
    } 
 
    const rideResult = await dbQuery('SELECT * FROM rides WHERE id = $1', [id]) 
    const ride = rideResult.rows[0]
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
 
    let updateQuery = 'UPDATE rides SET status = $1' 
    const params = [status] 
 
    if (status === 'concluida') { 
      updateQuery += ', concluida_at = CURRENT_TIMESTAMP' 
    } else if (status === 'cancelada') { 
      updateQuery += ', cancelada_at = CURRENT_TIMESTAMP' 
    } 
 
    updateQuery += ' WHERE id = $2' 
    params.push(id) 
 
    await dbQuery(updateQuery, params) 
 
    if (status === 'cancelada') {
      await dbQuery("UPDATE rides SET cancelado_por = 'admin' WHERE id = $1", [id])
    }

    if (status === 'concluida') { 
      const io = getIo()
      if (io) {
        io.to(`ride:${id}`).emit('corrida:concluida', { rideId: id, driver_id: ride.driver_id })
      }
      if (ride.driver_id) { 
        const driverResult = await dbQuery('SELECT * FROM drivers WHERE id = $1', [ride.driver_id]) 
        const driver = driverResult.rows[0]
        if (driver) { 
          console.log('[DEBUG] Enviando avaliação para motorista:', driver.telegram_id) 
          try { 
            await notifyDriverRateClient(driver, ride) 
            console.log('[DEBUG] Avaliação enviada com sucesso') 
          } catch(err) { 
            console.error('[DEBUG] Erro ao enviar avaliação:', err.message) 
          } 
          await dbQuery('UPDATE drivers SET total_viagens = total_viagens + 1 WHERE id = $1', [driver.id]) 
        } 
      } 
      if (ride.client_id) { 
        await dbQuery('UPDATE clients SET total_corridas = total_corridas + 1 WHERE id = $1', [ride.client_id]) 
      } 
      if (ride.telegram_message_id) { 
        await editGroupMessage( 
          ride.telegram_message_id, 
          `✅ *Corrida concluída!*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}\n💰 R$ ${Number(ride.valor).toFixed(2)}` 
        ) 
      } 
    } 
 
    if (status === 'cancelada' && ride.telegram_message_id) { 
      await editGroupMessage( 
        ride.telegram_message_id, 
        `❌ *Corrida cancelada.*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}` 
      ) 
    } 
 
    return { mensagem: `Status atualizado para ${status}` } 
  }) 
 
  fastify.put('/api/rides/:id/maps', { preHandler: requireAuth }, async (request, reply) => { 
    const { maps_link } = request.body 
    const { id } = request.params 
 
    const rideResult = await dbQuery('SELECT id FROM rides WHERE id = $1', [id]) 
    const ride = rideResult.rows[0]
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
 
    await dbQuery('UPDATE rides SET maps_link = $1 WHERE id = $2', [maps_link, id]) 
    return { mensagem: 'Link do mapa salvo' } 
  }) 
 
  // Listar tarifas 
  fastify.get('/api/tarifas', { preHandler: requireAuth }, async () => { 
    const result = await dbQuery('SELECT * FROM tarifas ORDER BY valor_minimo') 
    return result.rows
  }) 
 
  // Atualizar tarifa 
  fastify.put('/api/tarifas/:id', { preHandler: requireAuth }, async (request, reply) => { 
    const { nome, dias, hora_inicio, hora_fim, valor_minimo, valor_km, km_minimo, ativo } = request.body 
    const { id } = request.params 
    await dbQuery(` 
      UPDATE tarifas SET 
        nome = COALESCE($1, nome), 
        dias = COALESCE($2, dias), 
        hora_inicio = COALESCE($3, hora_inicio), 
        hora_fim = COALESCE($4, hora_fim), 
        valor_minimo = COALESCE($5, valor_minimo), 
        valor_km = COALESCE($6, valor_km), 
        km_minimo = COALESCE($7, km_minimo), 
        ativo = COALESCE($8, ativo) 
      WHERE id = $9 
    `, [nome, dias, hora_inicio, hora_fim, valor_minimo, valor_km, km_minimo, ativo, id]) 
    return { mensagem: 'Tarifa atualizada' } 
  }) 
 
  // Rota pública para o cliente calcular o valor 
  fastify.get('/api/tarifas/calcular', async (request) => { 
    const { data_hora, distancia_km } = request.query 
    const resultado = await calcularTarifa(data_hora, parseFloat(distancia_km)) 
    return resultado 
  }) 

  // Obter corrida pelo token (público) 
  fastify.get('/api/rides/token/:token', async (request, reply) => { 
    const { token } = request.params 
    const ride = (await query(` 
      SELECT 
        r.*, 
        d.nome as driver_nome, d.placa, d.modelo_carro, d.cor_carro, d.ano_carro, d.telefone as driver_telefone, d.foto_base64 as driver_foto, d.media_avaliacao as driver_media, d.total_viagens as driver_viagens, 
        c.nome as client_nome, c.telefone as client_telefone, c.media_avaliacao as client_media 
      FROM rides r 
      LEFT JOIN drivers d ON r.driver_id = d.id 
      LEFT JOIN clients c ON r.client_id = c.id 
      WHERE r.token = $1 
    `, [token])).rows[0] 

    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    return ride 
  }) 
 
  // Métricas para o Dashboard 
  fastify.get('/api/metricas', { preHandler: requireAuth }, async (request) => { 
    const { dataInicio, dataFim } = request.query

    // Define o intervalo padrão (últimos 15 dias)
    let dataInicioParam = dataInicio ? new Date(dataInicio) : new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
    let dataFimParam = dataFim ? new Date(dataFim) : new Date()

    // Ajusta para o início do dia e fim do dia
    dataInicioParam.setHours(0, 0, 0, 0)
    dataFimParam.setHours(23, 59, 59, 999)

    const resumoDiaResult = await dbQuery(` 
      SELECT 
        COUNT(*) as total_hoje, 
        ROUND(SUM(CASE WHEN status = 'concluida' THEN valor ELSE 0 END)::numeric, 2) as receita_hoje,
        ROUND(SUM(CASE WHEN status = 'concluida' THEN valor * 0.25 ELSE 0 END)::numeric, 2) as lucro_hoje,
        SUM(CASE WHEN status = 'aberta' THEN 1 ELSE 0 END) as abertas, 
        SUM(CASE WHEN status = 'agendada' THEN 1 ELSE 0 END) as agendadas, 
        SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) as concluidas 
      FROM rides 
      WHERE created_at::date = CURRENT_DATE 
    `) 
    const resumoDia = resumoDiaResult.rows[0]

    const motoristasAtivosResult = await dbQuery( 
      'SELECT COUNT(*) as total FROM drivers WHERE ativo = 1' 
    ) 
    const motoristasAtivos = motoristasAtivosResult.rows[0]

    // Frota atual
    const motoristasDisponiveisResult = await dbQuery(`
      SELECT COUNT(*) as total FROM drivers 
      WHERE ativo = 1 AND online = 1 AND status_cadastro = 'aprovado'
      AND NOT EXISTS (SELECT 1 FROM rides WHERE driver_id = drivers.id AND status IN ('aceita', 'em_viagem'))
    `)
    const motoristasDisponiveis = motoristasDisponiveisResult.rows[0]

    const motoristasEmViagemResult = await dbQuery(`
      SELECT COUNT(*) as total FROM drivers
      WHERE ativo = 1 AND online = 1 AND status_cadastro = 'aprovado'
      AND EXISTS (SELECT 1 FROM rides WHERE driver_id = drivers.id AND status IN ('aceita', 'em_viagem'))
    `)
    const motoristasEmViagem = motoristasEmViagemResult.rows[0]

    const dadosPeriodoResult = await dbQuery(` 
      SELECT 
        created_at::date as dia, 
        COUNT(*) as corridas, 
        ROUND(SUM(CASE WHEN status='concluida' THEN valor ELSE 0 END)::numeric, 2) as receita,
        ROUND(SUM(CASE WHEN status='concluida' THEN valor * 0.25 ELSE 0 END)::numeric, 2) as lucro_liquido, 
        SUM(CASE WHEN status='concluida' THEN 1 ELSE 0 END) as concluidas 
      FROM rides 
      WHERE created_at >= $1 AND created_at <= $2
      GROUP BY created_at::date 
      ORDER BY dia ASC 
    `, [dataInicioParam.toISOString(), dataFimParam.toISOString()]) 
    const dadosPeriodo = dadosPeriodoResult.rows

    // Demandas por hora (últimos 7 dias, independente do filtro)
    const demandasPorHoraResult = await dbQuery(`
      SELECT 
        EXTRACT(HOUR FROM created_at) as hora,
        COUNT(*) as total
      FROM rides
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY hora ASC
    `)
    const demandasPorHora = demandasPorHoraResult.rows.map(r => ({
      hora: parseInt(r.hora),
      total: parseInt(r.total)
    }))

    const tempoMedioAceiteResult = await dbQuery(` 
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (aceita_at - created_at)) / 60)::numeric, 1) as minutos 
      FROM rides WHERE aceita_at IS NOT NULL AND created_at >= $1 AND created_at <= $2
    `, [dataInicioParam.toISOString(), dataFimParam.toISOString()]) 
    const tempoMedioAceite = tempoMedioAceiteResult.rows[0]

    const topMotoristasResult = await dbQuery(` 
      SELECT d.nome, d.total_viagens, ROUND(d.media_avaliacao::numeric, 1) as nota, 
        ROUND(SUM(r.valor)::numeric, 2) as receita 
      FROM drivers d JOIN rides r ON r.driver_id = d.id 
      WHERE r.status = 'concluida' AND r.created_at >= $1 AND r.created_at <= $2
      GROUP BY d.id, d.nome, d.total_viagens, d.media_avaliacao ORDER BY receita DESC LIMIT 5 
    `, [dataInicioParam.toISOString(), dataFimParam.toISOString()]) 
    const topMotoristas = topMotoristasResult.rows

    const avaliacaoMediaResult = await dbQuery(` 
      SELECT ROUND(AVG(estrelas_motorista)::numeric, 1) as motoristas, 
        ROUND(AVG(estrelas_cliente)::numeric, 1) as clientes 
      FROM ratings 
    `) 
    const avaliacaoMedia = avaliacaoMediaResult.rows[0]

    const corridasAtivasResult = await dbQuery(` 
      SELECT r.*, d.nome as driver_nome, d.placa 
      FROM rides r LEFT JOIN drivers d ON r.driver_id = d.id 
      WHERE r.status IN ('aberta', 'aceita', 'agendada') 
      ORDER BY r.created_at DESC 
    `) 
    const corridasAtivas = corridasAtivasResult.rows

    return { 
      resumoDia: { 
        total_hoje: parseInt(resumoDia.total_hoje) || 0, 
        receita_hoje: parseFloat(resumoDia.receita_hoje) || 0,
        lucro_hoje: parseFloat(resumoDia.lucro_hoje) || 0,
        abertas: parseInt(resumoDia.abertas) || 0, 
        agendadas: parseInt(resumoDia.agendadas) || 0, 
        concluidas: parseInt(resumoDia.concluidas) || 0, 
        motoristas_ativos: parseInt(motoristasAtivos.total) || 0,
        motoristas_disponiveis: parseInt(motoristasDisponiveis.total) || 0,
        motoristas_em_viagem: parseInt(motoristasEmViagem.total) || 0
      }, 
      dadosPeriodo,
      demandas_por_hora: demandasPorHora,
      tempoMedioAceite: parseFloat(tempoMedioAceite.minutos) || 0, 
      topMotoristas, 
      avaliacaoMedia, 
      corridasAtivas 
    } 
  }) 
 
  // Motorista chegou ao ponto de embarque 
  fastify.put('/api/rides/:id/motorista-chegou', async (request, reply) => { 
    const { id } = request.params 
    const { token_motorista } = request.body || {} 
  
    // Aceita tanto admin quanto motorista 
    let autorizado = false 
    try { 
      await request.jwtVerify() 
      autorizado = true 
    } catch(e) { 
      // Verifica token do motorista 
      if (token_motorista) { 
        const driver = (await query( 
          'SELECT id FROM drivers WHERE token_perfil = $1', [token_motorista] 
        )).rows[0] 
        if (driver) autorizado = true 
      } 
    } 
    if (!autorizado) return reply.code(401).send({ error: 'Não autorizado' }) 
  
    const ride = (await query('SELECT * FROM rides WHERE id = $1', [id])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    if (ride.status !== 'aceita') return reply.code(400).send({ error: 'Corrida não está aceita' }) 
  
    await query(` 
      UPDATE rides SET 
        status_detalhe = 'aguardando_passageiro', 
        motorista_chegou_at = CURRENT_TIMESTAMP 
      WHERE id = $1 AND motorista_chegou_at IS NULL 
    `, [id]) 
  
    const config = await getConfig() 
    return { 
      mensagem: 'Chegada registrada. Timer de espera iniciado.', 
      minutos_gratis: config.espera_minutos_gratis, 
      valor_por_minuto: config.espera_valor_minuto 
    } 
  }) 
  
  // Passageiro embarcou 
  fastify.put('/api/rides/:id/passageiro-embarcou', async (request, reply) => { 
    const { id } = request.params 
    const { token_motorista } = request.body || {} 
  
    let autorizado = false 
    try { 
      await request.jwtVerify() 
      autorizado = true 
    } catch(e) { 
      if (token_motorista) { 
        const driver = (await query( 
          'SELECT id FROM drivers WHERE token_perfil = $1', [token_motorista] 
        )).rows[0] 
        if (driver) autorizado = true 
      } 
    } 
    if (!autorizado) return reply.code(401).send({ error: 'Não autorizado' }) 
  
    const ride = (await query('SELECT * FROM rides WHERE id = $1', [id])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    if (!ride.motorista_chegou_at) return reply.code(400).send({ error: 'Registre chegada primeiro' }) 
  
    const config = await getConfig() 
    const { calcularTempoMinutos, calculateInitialWaitCost } = await import('../billing.js') 
    const tempoEspera = calcularTempoMinutos(ride.motorista_chegou_at) 
    const custoEspera = calculateInitialWaitCost(tempoEspera, config) 
  
    await query(` 
      UPDATE rides SET 
        status_detalhe = 'em_andamento', 
        passageiro_embarcou_at = CURRENT_TIMESTAMP, 
        tempo_espera_inicial_min = $1, 
        custo_espera_inicial = $2 
      WHERE id = $3 
    `, [tempoEspera, custoEspera, id]) 
  
    return { 
      mensagem: 'Passageiro embarcou! Corrida iniciada!', 
      tempo_espera_min: tempoEspera.toFixed(1), 
      custo_espera: custoEspera 
    } 
  }) 
  
  // Iniciar parada 
  fastify.post('/api/rides/:id/parada/iniciar', async (request, reply) => { 
    const { id } = request.params 
    const { token_motorista } = request.body || {} 
  
    let autorizado = false 
    try { 
      await request.jwtVerify() 
      autorizado = true 
    } catch(e) { 
      if (token_motorista) { 
        const driver = (await query( 
          'SELECT id FROM drivers WHERE token_perfil = $1', [token_motorista] 
        )).rows[0] 
        if (driver) autorizado = true 
      } 
    } 
    if (!autorizado) return reply.code(401).send({ error: 'Não autorizado' }) 
  
    const paradaAberta = (await query( 
      'SELECT id FROM ride_stops WHERE ride_id = $1 AND finalizada_at IS NULL', [id] 
    )).rows[0] 
    if (paradaAberta) return reply.code(400).send({ error: 'Já existe parada em andamento' }) 
  
    const result = await query( 
      'INSERT INTO ride_stops (ride_id) VALUES ($1) RETURNING id', [id] 
    ) 
    await query( 
      "UPDATE rides SET status_detalhe = 'em_parada', num_paradas = num_paradas + 1 WHERE id = $1", [id] 
    ) 
  
    const config = await getConfig() 
    return { 
      mensagem: 'Parada iniciada', 
      stop_id: result.rows[0].id, 
      minutos_gratis: config.parada_minutos_gratis 
    } 
  }) 
 
  // Finalizar parada 
  fastify.put('/api/rides/:id/parada/:stopId/finalizar', { preHandler: requireAuth }, async (request, reply) => { 
    const { id, stopId } = request.params 
 
    const stop = (await query( 
      'SELECT * FROM ride_stops WHERE id = $1 AND ride_id = $2 AND finalizada_at IS NULL', 
      [stopId, id] 
    )).rows[0] 
    if (!stop) return reply.code(404).send({ error: 'Parada não encontrada' }) 
 
    const config = await getConfig() 
    const duracaoMin = calcularTempoMinutos(stop.iniciada_at) 
    const custo = calculateStopCost(duracaoMin, config) 
 
    await query(` 
      UPDATE ride_stops SET 
        finalizada_at = CURRENT_TIMESTAMP, 
        duracao_min = $1, 
        custo = $2 
      WHERE id = $3 
    `, [duracaoMin, custo, stopId]) 
 
    // Soma custo das paradas na corrida 
    const totalParadas = (await query( 
      'SELECT COALESCE(SUM(custo), 0) as total, COALESCE(SUM(duracao_min), 0) as tempo FROM ride_stops WHERE ride_id = $1', 
      [id] 
    )).rows[0] 
 
    await query(` 
      UPDATE rides SET 
        status_detalhe = 'em_andamento', 
        custo_paradas = $1, 
        tempo_paradas_total_min = $2 
      WHERE id = $3 
    `, [totalParadas.total, totalParadas.tempo, id]) 
 
    return { 
      mensagem: 'Parada finalizada', 
      duracao_min: duracaoMin.toFixed(1), 
      custo_parada: custo, 
      total_paradas: parseFloat(totalParadas.total) 
    } 
  }) 
 
  // Cancelar por espera 
  fastify.put('/api/rides/:id/cancelar-espera', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    const ride = (await query('SELECT * FROM rides WHERE id = $1', [id])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    if (!ride.motorista_chegou_at) return reply.code(400).send({ error: 'Timer não iniciado' }) 
 
    const config = await getConfig() 
 
    if (!podeMotoristaCancel(ride.motorista_chegou_at, config)) { 
      const tempoEspera = calcularTempoMinutos(ride.motorista_chegou_at) 
      return reply.code(400).send({ 
        error: `Aguarde ${config.espera_max_cancelamento} minutos para cancelar. Tempo atual: ${tempoEspera.toFixed(1)} min` 
      }) 
    } 
 
    const taxaCancelamento = parseFloat(config.espera_taxa_cancelamento || 7) 
    const tempoEspera = calcularTempoMinutos(ride.motorista_chegou_at) 
 
    await query(` 
      UPDATE rides SET 
        status = 'cancelada', 
        cancelada_at = CURRENT_TIMESTAMP, 
        cancelado_por_espera = 1, 
        taxa_cancelamento = $1, 
        tempo_espera_inicial_min = $2, 
        valor_final = $3 
      WHERE id = $4 
    `, [taxaCancelamento, tempoEspera, taxaCancelamento, id]) 
 
    return { 
      mensagem: 'Corrida cancelada por tempo de espera excedido', 
      taxa_cancelamento: taxaCancelamento, 
      tempo_espera_min: tempoEspera.toFixed(1) 
    } 
  }) 
 
  // Cancelar corrida pelo admin
  fastify.put('/api/rides/:id/cancelar', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params
    const ride = (await dbQuery('SELECT * FROM rides WHERE id = $1', [id])).rows[0]
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' })

    await dbQuery(`
      UPDATE rides SET 
        status = 'cancelada', 
        cancelada_at = CURRENT_TIMESTAMP, 
        cancelado_por = 'admin' 
      WHERE id = $1
    `, [id])

    if (ride.telegram_message_id) {
      try {
        await editGroupMessage(
          ride.telegram_message_id,
          `❌ *Corrida cancelada pelo admin.*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}`
        )
      } catch (e) {
        console.error('[RIDES] Erro ao editar mensagem Telegram:', e.message)
      }
    }

    return { mensagem: 'Corrida cancelada com sucesso' }
  })

  // Obter resumo financeiro da corrida 
  fastify.get('/api/rides/:id/resumo-financeiro', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    const ride = (await query('SELECT * FROM rides WHERE id = $1', [id])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 

    const config = await getConfig() 
    const paradas = (await query('SELECT * FROM ride_stops WHERE ride_id = $1 ORDER BY iniciada_at', [id])).rows 

    const valorBase = ride.valor || 0 
    const custoEspera = ride.custo_espera_inicial || 0 
    const custoParadas = ride.custo_paradas || 0 
    const valorFinal = calculateTotalRideCost(valorBase, custoEspera, custoParadas, config) 

    const splitRule = (await query("SELECT * FROM split_rules WHERE ativo = 1 ORDER BY id LIMIT 1")).rows[0]
    const percentualPlataforma = splitRule?.percentual_plataforma || 15 
    const percentualLider = splitRule?.percentual_lider || 2 
    const percentualMotorista = splitRule?.percentual_motorista || 83 

    const valorPlataforma = parseFloat((valorFinal * percentualPlataforma / 100).toFixed(2)) 
    const valorLider = parseFloat((valorFinal * percentualLider / 100).toFixed(2)) 
    const valorMotorista = parseFloat((valorFinal - valorPlataforma - valorLider).toFixed(2)) 

    return { 
      valor_base: valorBase, 
      custo_espera_inicial: custoEspera, 
      tempo_espera_min: ride.tempo_espera_inicial_min || 0, 
      custo_paradas: custoParadas, 
      tempo_paradas_min: ride.tempo_paradas_total_min || 0, 
      num_paradas: ride.num_paradas || 0, 
      valor_final: valorFinal, 
      valor_motorista: valorMotorista, 
      valor_mobihub: valorPlataforma, 
      valor_lider: valorLider,
      paradas_detalhe: paradas, 
      cancelado_por_espera: ride.cancelado_por_espera === 1, 
      taxa_cancelamento: ride.taxa_cancelamento || 0 
    } 
  }) 
 
}
