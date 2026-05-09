import { query, pool } from '../db.js' 
import { requireAuth } from '../middleware/auth.js' 
 
export default async function publicRoutes(fastify) { 
 
  // Configurações públicas
  fastify.get('/api/config/mapbox', async (request, reply) => {
    return { token: process.env.MAPBOX_TOKEN };
  });

  // --- ROTAS DE CHAT ---
  
  // Buscar mensagens da corrida (passageiro) 
  fastify.get('/api/ride/:token/mensagens', async (request, reply) => { 
    const ride = (await query('SELECT id FROM rides WHERE token = $1', [request.params.token])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    const mensagens = (await query( 
      'SELECT id, remetente, mensagem, created_at, lida FROM ride_messages WHERE ride_id = $1 ORDER BY created_at ASC', 
      [ride.id] 
    )).rows 
    await query("UPDATE ride_messages SET lida = 1 WHERE ride_id = $1 AND remetente = 'motorista' AND lida = 0", [ride.id]) 
    return { mensagens } 
  }) 
 
  // Marcar mensagens como lidas (passageiro lendo as do motorista) 
  fastify.post('/api/chat/:token/lida', async (request, reply) => { 
    const ride = (await query('SELECT id FROM rides WHERE token = $1', [request.params.token])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    await query("UPDATE ride_messages SET lida = 1 WHERE ride_id = $1 AND remetente = 'motorista' AND lida = 0", [ride.id]) 
    return { success: true } 
  }) 
 
  // Atualizar localização do motorista 
  fastify.post('/api/motorista/localizacao', async (request, reply) => { 
    const { driver_id, lat, lng } = request.body 
    if (!driver_id || !lat || !lng) return reply.code(400).send({ error: 'Dados incompletos' }) 
 
    await query(` 
      INSERT INTO driver_locations (driver_id, lat, lng, updated_at) 
      VALUES ($1, $2, $3, NOW()) 
      ON CONFLICT (driver_id) DO UPDATE SET lat = $2, lng = $3, updated_at = NOW() 
    `, [driver_id, lat, lng]) 
 
    return { success: true } 
  })
 
  // Passageiro envia mensagem 
  fastify.post('/api/ride/:token/mensagem', async (request, reply) => { 
    const { mensagem } = request.body 
    if (!mensagem?.trim()) return reply.code(400).send({ error: 'Mensagem vazia' }) 
    const ride = (await query("SELECT id FROM rides WHERE token = $1 AND status = 'aceita'", [request.params.token])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida não ativa' }) 
    await query('INSERT INTO ride_messages (ride_id, remetente, mensagem) VALUES ($1, $2, $3)', [ride.id, 'passageiro', mensagem.trim()]) 
    return { mensagem: 'Enviado' } 
  }) 
 
  // Motorista envia mensagem 
  fastify.post('/api/motorista/:token/mensagem/:rideId', async (request, reply) => { 
    const { mensagem } = request.body 
    const { token, rideId } = request.params 
    if (!mensagem?.trim()) return reply.code(400).send({ error: 'Mensagem vazia' }) 
    const driver = (await query('SELECT id FROM drivers WHERE token_perfil = $1', [token])).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
    const ride = (await query("SELECT id FROM rides WHERE id = $1 AND driver_id = $2 AND status IN ('aceita', 'em_viagem')", [rideId, driver.id])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    await query('INSERT INTO ride_messages (ride_id, remetente, mensagem) VALUES ($1, $2, $3)', [ride.id, 'motorista', mensagem.trim()]) 
    return { mensagem: 'Enviado' } 
  }) 
 
  // Motorista busca mensagens 
  fastify.get('/api/motorista/:token/mensagens/:rideId', async (request, reply) => { 
    const { token, rideId } = request.params 
    const driver = (await query('SELECT id FROM drivers WHERE token_perfil = $1', [token])).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
    const mensagens = (await query( 
      'SELECT id, remetente, mensagem, created_at, lida FROM ride_messages WHERE ride_id = $1 ORDER BY created_at ASC', 
      [rideId] 
    )).rows 
    await query("UPDATE ride_messages SET lida = 1 WHERE ride_id = $1 AND remetente = 'passageiro' AND lida = 0", [rideId]) 
    return { mensagens } 
  }) 

  // Marcar mensagens como lidas (motorista lendo as do passageiro) 
  fastify.post('/api/motorista/:token/chat/:rideId/lida', async (request, reply) => { 
    const { token, rideId } = request.params 
    const driver = (await query('SELECT id FROM drivers WHERE token_perfil = $1', [token])).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
    await query("UPDATE ride_messages SET lida = 1 WHERE ride_id = $1 AND remetente = 'passageiro' AND lida = 0", [rideId]) 
    return { success: true } 
  }) 

  // --- LOCALIZAÇÃO E ETA ---

  fastify.post('/api/motorista/:token/location', async (request, reply) => { 
    const { lat, lng, ride_id } = request.body 
    console.log('[LOCATION] Recebendo:', { lat, lng, ride_id, token: request.params.token }) 

    const driver = (await query( 
      'SELECT id FROM drivers WHERE token_perfil = $1', [request.params.token] 
    )).rows[0] 
    if (!driver) { 
      console.log('[LOCATION] Motorista não encontrado') 
      return reply.code(404).send({ error: 'Motorista não encontrado' }) 
    } 

    const existing = (await query( 
      'SELECT id FROM driver_locations WHERE driver_id = $1', 
      [driver.id] 
    )).rows[0] 

    if (existing) { 
      await query( 
        'UPDATE driver_locations SET lat = $1, lng = $2, updated_at = CURRENT_TIMESTAMP, ride_id = $3 WHERE driver_id = $4', 
        [lat, lng, ride_id, driver.id] 
      ) 
    } else { 
      await query( 
        'INSERT INTO driver_locations (driver_id, ride_id, lat, lng) VALUES ($1, $2, $3, $4)', 
        [driver.id, ride_id, lat, lng] 
      ) 
    } 

    console.log('[LOCATION] Salvo com sucesso') 
    return { ok: true } 
  }) 

  fastify.get('/api/ride/:token/motorista-location', async (request, reply) => { 
    const { token } = request.params 
    const ride = (await query(` 
      SELECT 
        r.id, r.driver_id, r.passageiro_embarcou_at, r.destino_lat, r.destino_lng, r.origem_lat, r.origem_lng, r.status, r.valor 
      FROM rides r 
      WHERE r.token = $1 
    `, [token])).rows[0] 
    if (!ride || !ride.driver_id) return { location: null } 
 
    const location = (await query(` 
      SELECT lat, lng, EXTRACT(EPOCH FROM (NOW() - updated_at)) as segundos_atras 
      FROM driver_locations WHERE driver_id = $1 ORDER BY updated_at DESC LIMIT 1 
    `, [ride.driver_id])).rows[0] 
 
    if (!location) return { location: null } 
 
    const destLat = ride.passageiro_embarcou_at ? ride.destino_lat : ride.origem_lat 
    const destLng = ride.passageiro_embarcou_at ? ride.destino_lng : ride.origem_lng 
 
    let etaMinutos = null 
    let distanciaKm = null 
 
    if (destLat && destLng) { 
      const R = 6371 
      const dLat = (destLat - location.lat) * Math.PI / 180 
      const dLng = (destLng - location.lng) * Math.PI / 180 
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
        Math.cos(location.lat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) * 
        Math.sin(dLng/2) * Math.sin(dLng/2) 
      distanciaKm = parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(1)) 
      etaMinutos = Math.max(1, Math.round(distanciaKm / 0.5)) 
    } 
 
    return { 
      valor: ride.valor, 
      location: { 
        lat: location.lat, 
        lng: location.lng, 
        segundos_atras: Math.round(location.segundos_atras), 
        ativo: location.segundos_atras < 120, 
        eta_minutos: etaMinutos, 
        distancia_km: distanciaKm, 
        fase: ride.passageiro_embarcou_at ? 'em_rota' : 'a_caminho' 
      } 
    } 
  }) 

  fastify.get('/api/motorista/:token/ultima-corrida', async (request, reply) => { 
    const driver = (await query( 
      'SELECT id FROM drivers WHERE token_perfil = $1', [request.params.token] 
    )).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
  
    const corrida = (await query(` 
      SELECT id, status, status_detalhe, valor, valor_motorista, valor_final, 
        origem, destino, concluida_at, cancelada_at 
      FROM rides WHERE driver_id = $1 
      ORDER BY COALESCE(concluida_at, cancelada_at, created_at) DESC 
      LIMIT 1 
    `, [driver.id])).rows[0] 
  
    return { corrida: corrida || null } 
  }) 

  // --- PERFIS E CADASTRO ---



  fastify.get('/api/motorista/:token', async (request, reply) => { 
    const result = await query(` 
      SELECT id, nome, modelo_carro, ano_carro, cor_carro, placa, 
        total_viagens, media_avaliacao, total_avaliacoes, 
        foto_base64, ativo, created_at, aceitou_termos 
      FROM drivers WHERE token_perfil = $1 
    `, [request.params.token]) 
    const driver = result.rows[0] 
 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    const corridasResult = await query(` 
      SELECT r.id, r.origem, r.destino, r.valor, r.valor_motorista, 
        r.status, r.created_at, r.concluida_at, r.tipo, 
        r.agendada_para 
      FROM rides r 
      WHERE r.driver_id = $1 
      ORDER BY r.created_at DESC 
      LIMIT 30 
    `, [driver.id]) 
    const corridas = corridasResult.rows 
 
    const comentariosResult = await query(` 
      SELECT rt.estrelas_motorista, rt.comentario_cliente, rt.avaliado_em_cliente 
      FROM ratings rt 
      JOIN rides r ON rt.ride_id = r.id 
      WHERE r.driver_id = $1 AND rt.estrelas_motorista IS NOT NULL 
      ORDER BY rt.avaliado_em_cliente DESC 
      LIMIT 20 
    `, [driver.id]) 
    const comentarios = comentariosResult.rows 
 
    const financeiroResult = await query(` 
      SELECT 
        COUNT(*) as total_corridas, 
        SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) as concluidas, 
        ROUND(SUM(CASE WHEN status = 'concluida' THEN CAST(COALESCE(valor_motorista, valor * 0.70) AS NUMERIC) ELSE 0 END), 2) as ganhos_total, 
        ROUND(SUM(CASE WHEN status = 'concluida' AND CAST(concluida_at AS DATE) = CURRENT_DATE THEN CAST(COALESCE(valor_motorista, valor * 0.70) AS NUMERIC) ELSE 0 END), 2) as ganhos_hoje, 
        ROUND(SUM(CASE WHEN status = 'concluida' AND concluida_at >= CURRENT_DATE - INTERVAL '7 days' THEN CAST(COALESCE(valor_motorista, valor * 0.70) AS NUMERIC) ELSE 0 END), 2) as ganhos_semana, 
        ROUND(SUM(CASE WHEN status = 'concluida' AND TO_CHAR(concluida_at, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM') THEN CAST(COALESCE(valor_motorista, valor * 0.70) AS NUMERIC) ELSE 0 END), 2) as ganhos_mes 
      FROM rides WHERE driver_id = $1 
    `, [driver.id]) 
    const financeiro = financeiroResult.rows[0] 
 
    return { driver, corridas, comentarios, financeiro } 
  }) 

  fastify.put('/api/motorista/:token/foto', async (request, reply) => { 
    const { foto_base64 } = request.body 
    if (!foto_base64) return reply.code(400).send({ error: 'Foto é obrigatória' }) 
    const driverResult = await query('SELECT id FROM drivers WHERE token_perfil = $1', [request.params.token]) 
    const driver = driverResult.rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
    await query('UPDATE drivers SET foto_base64 = $1 WHERE id = $2', [foto_base64, driver.id]) 
    return { mensagem: 'Foto atualizada com sucesso!' } 
  }) 

  fastify.get('/api/motorista/:token/corrida-disponivel', async (request, reply) => { 
    const driver = (await query( 
      "SELECT id FROM drivers WHERE token_perfil = $1 AND ativo = 1 AND online = 1 AND status_cadastro = 'aprovado'", 
      [request.params.token] 
    )).rows[0] 
    if (!driver) return { corrida: null } 
 
    const corrida = (await query(` 
      SELECT r.*, c.nome as client_nome, c.media_avaliacao as client_media 
      FROM rides r 
      LEFT JOIN clients c ON r.client_id = c.id 
      WHERE r.status = 'aberta' 
      AND r.driver_id IS NULL 
      ORDER BY r.created_at ASC 
      LIMIT 1 
    `)).rows[0] 
    return { corrida: corrida || null } 
  }) 
 
  fastify.get('/api/motorista/:token/corrida-ativa', async (request, reply) => { 
    const driver = (await query( 
      'SELECT id FROM drivers WHERE token_perfil = $1', 
      [request.params.token] 
    )).rows[0] 
    if (!driver) return { corrida: null } 
 
    const corrida = (await query( 
      "SELECT * FROM rides WHERE driver_id = $1 AND status IN ('aceita', 'em_viagem') ORDER BY aceita_at DESC LIMIT 1", 
      [driver.id] 
    )).rows[0] 
    return { corrida: corrida || null } 
  }) 

  fastify.get('/api/motoristas-online', async (request, reply) => { 
    const motoristas = (await query(` 
      SELECT 
        d.id, d.nome, d.modelo_carro, d.cor_carro, d.ano_carro, 
        d.media_avaliacao, d.total_viagens, 
        dl.lat, dl.lng, 
        EXTRACT(EPOCH FROM (NOW() - dl.updated_at)) as segundos_atras 
      FROM drivers d 
      LEFT JOIN LATERAL ( 
        SELECT lat, lng, updated_at 
        FROM driver_locations 
        WHERE driver_id = d.id 
        ORDER BY updated_at DESC 
        LIMIT 1 
      ) dl ON true 
      WHERE d.ativo = 1 
      AND d.online = 1 
      AND d.status_cadastro = 'aprovado' 
      AND NOT EXISTS ( 
        SELECT 1 FROM rides r 
        WHERE r.driver_id = d.id AND r.status IN ('aceita', 'em_viagem') 
      ) 
    `)).rows 
  
    return motoristas.map(m => ({ 
      id: m.id, 
      nome: m.nome.split(' ')[0], 
      carro: `${m.modelo_carro} ${m.cor_carro}`, 
      media: m.media_avaliacao, 
      viagens: m.total_viagens, 
      lat: m.lat && m.segundos_atras < 300 ? m.lat : null, 
      lng: m.lng && m.segundos_atras < 300 ? m.lng : null, 
      tem_localizacao: !!(m.lat && m.segundos_atras < 300) 
    })) 
  }) 

  fastify.get('/api/convite/:token', async (request, reply) => { 
    const result = await query( 
      'SELECT * FROM convites WHERE token = $1 AND usado = false AND expira_em > NOW()', 
      [request.params.token] 
    ) 
    if (!result.rows.length) return reply.code(404).send({ error: 'Convite inválido ou expirado' }) 
    return { valido: true } 
  }) 
 
  fastify.post('/api/cadastro-motorista/:token', async (request, reply) => { 
    const { token } = request.params 
    const { nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, foto_base64 } = request.body 
    const convite = (await query('SELECT * FROM convites WHERE token = $1 AND usado = false AND expira_em > NOW()', [token])).rows[0] 
    if (!convite) return reply.code(400).send({ error: 'Convite inválido ou expirado' }) 
    const existing = (await query('SELECT id FROM drivers WHERE telegram_id = $1', [telegram_id])).rows[0] 
    if (existing) return reply.code(409).send({ error: 'Este Telegram ID já está cadastrado' }) 
    const { v4: uuidv4 } = await import('uuid') 
    const tokenPerfil = uuidv4() 
    const result = await query(` 
      INSERT INTO drivers 
        (nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, 
         foto_base64, token_perfil, status_cadastro, ativo) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendente', 0) 
      RETURNING id 
    `, [nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, foto_base64 || null, tokenPerfil]) 
    const driverId = result.rows[0].id 
    await query('UPDATE convites SET usado = true, usado_em = NOW(), driver_id = $1 WHERE token = $2', [driverId, token]) 
    try { 
      const { getBot } = await import('../telegram.js') 
      const bot = getBot() 
      bot?.sendMessage(process.env.TELEGRAM_GROUP_ID, 
        `🆕 *Novo motorista aguardando aprovação!*\n\n👤 ${nome}\n🚗 ${modelo_carro} ${cor_carro} ${ano_carro}\n📋 Placa: ${placa}\n📱 Tel: ${telefone}`, 
        { parse_mode: 'Markdown' } 
      ).catch(() => {}) 
    } catch(e) {} 
    return { mensagem: 'Cadastro enviado com sucesso! Aguarde aprovação.' } 
  }) 

  // --- AÇÕES DE CORRIDA ---

  fastify.post('/api/solicitar', async (request, reply) => { 
    const { 
      nome, celular, email, 
      origem, origem_lat, origem_lng, 
      destino, destino_lat, destino_lng, 
      valor, tipo, agendada_para 
    } = request.body 
    if (!origem || !destino || !valor || !celular) return reply.code(400).send({ error: 'Dados incompletos' }) 
    const clientResult = await query('SELECT * FROM clients WHERE telefone = $1', [celular]) 
    let client = clientResult.rows[0] 
    if (!client) { 
      const r = await query(`INSERT INTO clients (telefone, nome, email) VALUES ($1, $2, $3) RETURNING id`, [celular, nome || null, email || null]) 
      client = { id: r.rows[0].id } 
    } else { 
      await query(`UPDATE clients SET nome = COALESCE($1, nome), email = COALESCE($2, email) WHERE id = $3`, [nome || null, email || null, client.id]) 
    } 
    const { v4: uuidv4 } = await import('uuid') 
    const token = uuidv4() 
    const statusInicial = tipo === 'agendada' ? 'agendada' : 'aberta' 
    const valorMotorista = parseFloat((valor * 0.70).toFixed(2)) 
    const valorMobihub = parseFloat((valor * 0.30).toFixed(2)) 
    const result = await query(` 
      INSERT INTO rides (token, client_id, origem, origem_lat, origem_lng, destino, destino_lat, destino_lng, valor, valor_motorista, valor_mobihub, tipo, agendada_para, status) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id 
    `, [token, client.id, origem, origem_lat, origem_lng, destino, destino_lat, destino_lng, valor, valorMotorista, valorMobihub, tipo || 'normal', agendada_para || null, statusInicial]) 
    const ride = (await query('SELECT * FROM rides WHERE id = $1', [result.rows[0].id])).rows[0] 
    if (!tipo || tipo === 'normal') { 
      try { 
        const { sendRideToGroup } = await import('../telegram.js') 
        const messageId = await sendRideToGroup(ride) 
        if (messageId) await query('UPDATE rides SET telegram_message_id = $1 WHERE id = $2', [messageId, ride.id]) 
      } catch(err) { console.error('[SOLICITAR] Erro Telegram:', err.message) } 
    } 
    return { token, link: `${process.env.BASE_URL}/r/${token}`, mensagem: 'Corrida solicitada!' } 
  }) 

  fastify.put('/api/rides/:id/aceitar-motorista', async (request, reply) => { 
    const { token_motorista } = request.body 
    const { id } = request.params 
    const driver = (await query("SELECT * FROM drivers WHERE token_perfil = $1 AND ativo = 1 AND status_cadastro = 'aprovado'", [token_motorista])).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
    const ride = (await query("SELECT * FROM rides WHERE id = $1 AND status = 'aberta'", [id])).rows[0] 
    if (!ride) return reply.code(400).send({ error: 'Corrida não disponível' }) 
    await query("UPDATE rides SET status = 'aceita', driver_id = $1, aceita_at = CURRENT_TIMESTAMP WHERE id = $2", [driver.id, id]) 
    if (ride.telegram_message_id) { 
      try { 
        const { editGroupMessage } = await import('../telegram.js') 
        await editGroupMessage(ride.telegram_message_id, `✅ *Corrida aceita!*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}\n\n🧑‍✈️ *${driver.nome}*\n🚗 ${driver.modelo_carro} ${driver.cor_carro}`) 
      } catch(e) {} 
    } 
    return { mensagem: 'Corrida aceita!', token: ride.token } 
  }) 

  // Motorista informa que o passageiro embarcou 
  fastify.post('/api/motorista/:token/embarcou/:rideId', async (request, reply) => { 
    const { token, rideId } = request.params 
    const driver = (await query('SELECT id FROM drivers WHERE token_perfil = $1', [token])).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    const ride = (await query('SELECT * FROM rides WHERE id = $1 AND driver_id = $2', [rideId, driver.id])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
 
    await query(` 
      UPDATE rides SET 
        status = 'em_viagem', 
        status_detalhe = 'em_andamento', 
        passageiro_embarcou_at = CURRENT_TIMESTAMP 
      WHERE id = $1 
    `, [rideId]) 
 
    return { success: true, mensagem: 'Passageiro embarcou!' } 
  }) 
 
  // Motorista informa que a corrida foi finalizada 
  fastify.put('/api/rides/:id/finalizar-motorista', async (request, reply) => { 
    const { token_motorista } = request.body 
    const { id } = request.params 
    const driver = (await query('SELECT * FROM drivers WHERE token_perfil = $1', [token_motorista])).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
    const ride = (await query(` 
      SELECT id, valor, valor_motorista, custo_espera_inicial, custo_paradas, 
        num_paradas, tempo_espera_inicial_min, tempo_paradas_total_min, 
        origem, destino, telegram_message_id, client_id 
      FROM rides 
      WHERE id = $1 AND driver_id = $2 AND status IN ('aceita', 'em_viagem') 
    `, [id, driver.id])).rows[0] 
    if (!ride) return reply.code(400).send({ error: 'Corrida não encontrada' }) 
    const { calculateTotalRideCost, calculateInitialWaitCost } = await import('../billing.js') 
    const configs = (await query('SELECT chave, valor FROM configuracoes')).rows 
    const config = {} 
    configs.forEach(c => config[c.chave] = c.valor) 
 
    // Cálculo detalhado para memória de cálculo 
    const waitInfo = calculateInitialWaitCost(ride.tempo_espera_inicial_min || 0, config) 
    const valorFinal = calculateTotalRideCost(ride.valor || 0, waitInfo.cost, ride.custo_paradas || 0, config) 
    const valorMotorista = parseFloat((valorFinal * 0.70).toFixed(2)) 
 
    await query(` 
      UPDATE rides SET 
        status = 'concluida', 
        concluida_at = CURRENT_TIMESTAMP, 
        valor_final = $1, 
        valor_motorista = $2, 
        valor_mobihub = $3, 
        base_value = $4, 
        wait_extra_minutes = $5, 
        wait_extra_charge = $6, 
        stop_extra_minutes = $7, 
        stop_extra_charge = $8, 
        total_value = $9 
      WHERE id = $10 
    `, [ 
      valorFinal, 
      valorMotorista, 
      parseFloat((valorFinal - valorMotorista).toFixed(2)), 
      ride.valor || 0, 
      waitInfo.extraMinutes, 
      waitInfo.cost, 
      ride.tempo_paradas_total_min || 0, 
      ride.custo_paradas || 0, 
      valorFinal, 
      id 
    ]) 
    await query('UPDATE drivers SET total_viagens = total_viagens + 1 WHERE id = $1', [driver.id]) 
    if (ride.client_id) await query('UPDATE clients SET total_corridas = total_corridas + 1 WHERE id = $1', [ride.client_id]) 
    try { 
      const { notifyDriverRateClient, editGroupMessage } = await import('../telegram.js') 
      await notifyDriverRateClient(driver, ride) 
      if (ride.telegram_message_id) await editGroupMessage(ride.telegram_message_id, `✅ *Corrida concluída!*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}\n💰 R$ ${valorFinal.toFixed(2)}`) 
    } catch(e) {} 
    return { mensagem: 'Corrida finalizada!', valor_final: valorFinal, valor_motorista: valorMotorista } 
  }) 

  fastify.put('/api/rides/:id/parada/ultima/finalizar', async (request, reply) => { 
    const { id } = request.params 
    const stop = (await query('SELECT * FROM ride_stops WHERE ride_id = $1 AND finalizada_at IS NULL ORDER BY iniciada_at DESC LIMIT 1', [id])).rows[0] 
    if (!stop) return reply.code(404).send({ error: 'Nenhuma parada' }) 
    const { calculateStopCost, calcularTempoMinutos } = await import('../billing.js') 
    const configs = (await query('SELECT chave, valor FROM configuracoes')).rows 
    const config = {} 
    configs.forEach(c => config[c.chave] = c.valor) 
    const duracao = calcularTempoMinutos(stop.iniciada_at) 
    const waitInfo = calculateStopCost(duracao, config) 
    const custo = waitInfo.cost 
    await query('UPDATE ride_stops SET finalizada_at = CURRENT_TIMESTAMP, duracao_min = $1, custo = $2 WHERE id = $3', [duracao, custo, stop.id]) 
    const totalParadas = (await query('SELECT COALESCE(SUM(custo),0) as total, COALESCE(SUM(duracao_min),0) as tempo FROM ride_stops WHERE ride_id = $1', [id])).rows[0] 
    await query("UPDATE rides SET status_detalhe = 'em_andamento', custo_paradas = $1, tempo_paradas_total_min = $2 WHERE id = $3", [totalParadas.total, totalParadas.tempo, id]) 
    return { mensagem: 'Parada finalizada!', custo_parada: custo } 
  }) 

  fastify.put('/api/ride/:token/cancelar', async (request, reply) => { 
    const ride = (await query( 
      "SELECT * FROM rides WHERE token = $1 AND status IN ('aberta', 'aceita')", 
      [request.params.token] 
    )).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida não pode ser cancelada' }) 
  
    // Não pode cancelar se passageiro já embarcou 
    if (ride.passageiro_embarcou_at) { 
      return reply.code(400).send({ error: 'Não é possível cancelar após embarque' }) 
    } 
  
    await query(` 
      UPDATE rides SET 
        status = 'cancelada', 
        cancelada_at = CURRENT_TIMESTAMP, 
        status_detalhe = 'cancelada_passageiro' 
      WHERE id = $1 
    `, [ride.id]) 
  
    // Notifica grupo Telegram 
    try { 
      const { editGroupMessage } = await import('../telegram.js') 
      if (ride.telegram_message_id) { 
        await editGroupMessage(ride.telegram_message_id, 
          `❌ *Corrida cancelada pelo passageiro*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}` 
        ) 
      } 
    } catch(e) {} 
  
    return { mensagem: 'Corrida cancelada' } 
  }) 

  fastify.put('/api/motorista/:token/cancelar-corrida/:rideId', async (request, reply) => { 
    const { token, rideId } = request.params 
  
    const driver = (await query( 
      'SELECT id FROM drivers WHERE token_perfil = $1', [token] 
    )).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
  
    const ride = (await query( 
      "SELECT * FROM rides WHERE id = $1 AND driver_id = $2 AND status IN ('aceita', 'aberta')", 
      [rideId, driver.id] 
    )).rows[0] 
  
    if (!ride) { 
      // Verifica se a corrida existe mas já foi finalizada 
      const corridaExiste = (await query( 
        'SELECT status FROM rides WHERE id = $1', [rideId] 
      )).rows[0] 
      if (corridaExiste) { 
        return reply.code(400).send({ error: `Não é possível cancelar corrida com status: ${corridaExiste.status}` }) 
      } 
      return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    } 
  
    if (ride.passageiro_embarcou_at) { 
      return reply.code(400).send({ error: 'Não é possível cancelar após embarque do passageiro' }) 
    } 
  
    await query(` 
      UPDATE rides SET 
        status = 'cancelada', 
        cancelada_at = CURRENT_TIMESTAMP, 
        status_detalhe = 'cancelada_motorista' 
      WHERE id = $1 
    `, [rideId]) 
  
    // Notifica grupo Telegram 
    try { 
      const { editGroupMessage } = await import('../telegram.js') 
      if (ride.telegram_message_id) { 
        await editGroupMessage(ride.telegram_message_id, 
          `❌ *Corrida cancelada pelo motorista*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}` 
        ) 
      } 
    } catch(e) {} 
  
    return { mensagem: 'Corrida cancelada com sucesso' } 
  }) 

  // Aceitar termos de uso e LGPD
  fastify.post('/api/motorista/aceitar-termos', async (request, reply) => {
    console.log("BODY RECEBIDO:", request.body)
    const { token, versao } = request.body
    if (!token) {
      console.log('[ACEITAR-TERMOS] Token missing in body')
      return reply.code(400).send('Token é obrigatório')
    }
    
    try {
      const driverResult = await query('SELECT id FROM drivers WHERE token_perfil = $1', [token])
      const driver = driverResult.rows[0]
      if (!driver) {
        console.log('[ACEITAR-TERMOS] Driver not found for token:', token)
        return reply.code(404).send('Motorista não encontrado')
      }
      
      const ip = request.ip || request.headers['x-forwarded-for'] || request.socket.remoteAddress
      console.log('[ACEITAR-TERMOS] Driver found, ID:', driver.id, 'IP:', ip, 'Versão:', versao || '1.2')
      
      await query(`
        UPDATE drivers SET
          aceitou_termos = true,
          data_aceite_termos = CURRENT_TIMESTAMP,
          ip_aceite_termos = $1,
          versao_termos = $2
        WHERE id = $3
      `, [ip, versao || '1.2', driver.id])
      
      console.log('[ACEITAR-TERMOS] Terms accepted successfully')
      return { mensagem: 'Termos aceitos com sucesso' }
    } catch (e) {
      console.error('[ACEITAR-TERMOS] Error:', e)
      return reply.code(400).send(e.message)
    }
  })

  // --- REPUTAÇÃO E AVALIAÇÕES ---

  fastify.post('/api/ride/:token/avaliar-motorista', async (request, reply) => { 
    const { estrelas, comentario } = request.body 
    if (!estrelas || estrelas < 1 || estrelas > 5) return reply.code(400).send({ error: '1-5 estrelas' }) 
    const ride = (await query('SELECT * FROM rides WHERE token = $1', [request.params.token])).rows[0] 
    if (!ride || ride.status !== 'concluida') return reply.code(400).send({ error: 'Corrida inválida' }) 
    const existing = (await query('SELECT * FROM ratings WHERE ride_id = $1', [ride.id])).rows[0] 
    if (existing?.estrelas_motorista) return reply.code(409).send({ error: 'Já avaliado' }) 
    if (existing) { 
      await query(`UPDATE ratings SET estrelas_motorista = $1, comentario_cliente = $2, avaliado_em_cliente = CURRENT_TIMESTAMP WHERE ride_id = $3`, [estrelas, comentario || null, ride.id]) 
    } else { 
      await query(`INSERT INTO ratings (ride_id, estrelas_motorista, comentario_cliente, avaliado_em_cliente) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`, [ride.id, estrelas, comentario || null]) 
    } 
    if (ride.driver_id) { 
      const stats = (await query(`SELECT AVG(estrelas_motorista) as media, COUNT(estrelas_motorista) as total FROM ratings WHERE ride_id IN (SELECT id FROM rides WHERE driver_id = $1) AND estrelas_motorista IS NOT NULL`, [ride.driver_id])).rows[0] 
      await query(`UPDATE drivers SET media_avaliacao = $1, total_avaliacoes = $2 WHERE id = $3`, [stats.media, stats.total, ride.driver_id]) 
    } 
    return { mensagem: 'Obrigado!', redirect: '/solicitar' } 
  }) 

  fastify.post('/api/internal/rate-client', async (request, reply) => { 
    const { ride_id, driver_telegram_id, estrelas, comentario } = request.body 
    const driver = (await query('SELECT * FROM drivers WHERE telegram_id = $1', [String(driver_telegram_id)])).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
    const ride = (await query('SELECT * FROM rides WHERE id = $1 AND driver_id = $2', [ride_id, driver.id])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    const existing = (await query('SELECT * FROM ratings WHERE ride_id = $1', [ride_id])).rows[0] 
    if (existing?.estrelas_cliente) return reply.code(409).send({ error: 'Já avaliado' }) 
    if (existing) { 
      await query(`UPDATE ratings SET estrelas_cliente = $1, comentario_motorista = $2, avaliado_em_motorista = CURRENT_TIMESTAMP WHERE ride_id = $3`, [estrelas, comentario || null, ride_id]) 
    } else { 
      await query(`INSERT INTO ratings (ride_id, estrelas_cliente, comentario_motorista, avaliado_em_motorista) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`, [ride_id, estrelas, comentario || null]) 
    } 
    if (ride.client_id) { 
      const stats = (await query(`SELECT AVG(estrelas_cliente) as media, COUNT(estrelas_cliente) as total FROM ratings WHERE ride_id IN (SELECT id FROM rides WHERE client_id = $1) AND estrelas_cliente IS NOT NULL`, [ride.client_id])).rows[0] 
      await query(`UPDATE clients SET media_avaliacao = $1, total_avaliacoes = $2 WHERE id = $3`, [stats.media, stats.total, ride.client_id]) 
    } 
    return { mensagem: 'Avaliação registrada' } 
  }) 

  fastify.get('/api/reputacao/corrida/:id', { preHandler: requireAuth }, async (request, reply) => { 
    const ride = (await query(`SELECT r.*, d.nome as driver_nome, d.media_avaliacao as driver_media, c.nome as client_nome FROM rides r LEFT JOIN drivers d ON r.driver_id = d.id LEFT JOIN clients c ON r.client_id = c.id WHERE r.id = $1`, [request.params.id])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Não encontrada' }) 
    const rating = (await query('SELECT * FROM ratings WHERE ride_id = $1', [request.params.id])).rows[0] 
    return { ride, rating } 
  }) 

  // Detalhamento de faturamento (Billing) 
  fastify.get('/api/rides/:id/billing', async (request, reply) => { 
    const { id } = request.params 
    const ride = (await query(` 
      SELECT 
        base_value, 
        wait_extra_minutes, wait_extra_charge, 
        stop_extra_minutes, stop_extra_charge, 
        total_value, status 
      FROM rides WHERE id = $1 
    `, [id])).rows[0] 
 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    return ride 
  }) 
 
  // Buscar corrida por token (melhorado para incluir campos de billing) 
  fastify.get('/api/ride/:token', async (request, reply) => { 
    const { token } = request.params 
    const ride = (await query(` 
      SELECT 
        r.*, 
        d.nome as driver_nome, d.placa, d.modelo_carro, d.cor_carro, d.ano_carro, d.telefone as driver_telefone, d.foto_base64 as driver_foto, d.media_avaliacao as driver_media, d.total_viagens as driver_viagens, d.total_avaliacoes as driver_avaliacoes, 
        c.nome as client_nome, c.telefone as client_telefone, c.media_avaliacao as client_media, c.total_avaliacoes as client_avaliacoes 
      FROM rides r 
      LEFT JOIN drivers d ON r.driver_id = d.id 
      LEFT JOIN clients c ON r.client_id = c.id 
      WHERE r.token = $1 
    `, [token])).rows[0]
 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    const rating = (await query('SELECT estrelas_motorista, comentario_cliente, avaliado_em_cliente FROM ratings WHERE ride_id = $1', [ride.id])).rows[0] 
    const paradas = (await query('SELECT duracao_min, custo, iniciada_at, finalizada_at FROM ride_stops WHERE ride_id = $1 ORDER BY iniciada_at', [ride.id])).rows 
    const configs = (await query('SELECT chave, valor FROM configuracoes')).rows 
    const config = {} 
    configs.forEach(c => config[c.chave] = c.valor) 
 
    delete ride.client_id 
    delete ride.driver_id 
 
    return { ride, rating, paradas, config } 
  }) 
} 
