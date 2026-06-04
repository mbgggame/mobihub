import { query, pool } from '../db.js' 
import { requireAuth } from '../middleware/auth.js'
import { getIo } from '../server.js'
import crypto from 'crypto' 

export default async function publicRoutes(fastify) { 

  // ConfiguraÃ§Ãµes pÃºblicas
  fastify.get('/api/config/mapbox', async (request, reply) => {
    return { token: process.env.MAPBOX_TOKEN };
  });

  // Verifica se cliente tem corrida nÃ£o paga
  fastify.get('/api/client/:telefone/corrida-pendente', async (request, reply) => {
    const { telefone } = request.params
    const client = (await query('SELECT id FROM clients WHERE telefone = $1', [telefone])).rows[0]
    if (!client) return reply.send({ tem_pendente: false })
    
    const ride = (await query(`
      SELECT id, zighu_pix_payload, valor_final, valor 
      FROM rides 
      WHERE client_id = $1 AND pagamento_status = 'aguardando_pagamento' 
      ORDER BY created_at DESC 
      LIMIT 1
    `, [client.id])).rows[0]
    
    if (ride) {
      return reply.send({ 
        tem_pendente: true, 
        corrida_id: ride.id, 
        pix_copia_cola: ride.zighu_pix_payload,
        valor: ride.valor_final || ride.valor
      })
    } else {
      return reply.send({ tem_pendente: false })
    }
  })

  // --- ROTAS DE CHAT ---
  
  // Buscar mensagens da corrida (passageiro) 
  fastify.get('/api/ride/:token/mensagens', async (request, reply) => { 
    const ride = (await query('SELECT id FROM rides WHERE token = $1', [request.params.token])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida nÃ£o encontrada' }) 
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
    if (!ride) return reply.code(404).send({ error: 'Corrida nÃ£o encontrada' }) 
    await query("UPDATE ride_messages SET lida = 1 WHERE ride_id = $1 AND remetente = 'motorista' AND lida = 0", [ride.id]) 
    return { success: true } 
  }) 

  // Atualizar localizaÃ§Ã£o do motorista 
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
    if (!ride) return reply.code(404).send({ error: 'Corrida nÃ£o ativa' }) 
    await query('INSERT INTO ride_messages (ride_id, remetente, mensagem) VALUES ($1, $2, $3)', [ride.id, 'passageiro', mensagem.trim()]) 
    return { mensagem: 'Enviado' } 
  }) 

  // Motorista envia mensagem 
  fastify.post('/api/motorista/:token/mensagem/:rideId', async (request, reply) => { 
    const { mensagem } = request.body 
    const { token, rideId } = request.params 
    if (!mensagem?.trim()) return reply.code(400).send({ error: 'Mensagem vazia' }) 
    const driver = (await query('SELECT id FROM drivers WHERE token_perfil = $1', [token])).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
    const ride = (await query("SELECT id FROM rides WHERE id = $1 AND driver_id = $2 AND status IN ('aceita', 'em_viagem')", [rideId, driver.id])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida nÃ£o encontrada' }) 
    await query('INSERT INTO ride_messages (ride_id, remetente, mensagem) VALUES ($1, $2, $3)', [ride.id, 'motorista', mensagem.trim()]) 
    return { mensagem: 'Enviado' } 
  }) 

  // Motorista busca mensagens 
  fastify.get('/api/motorista/:token/mensagens/:rideId', async (request, reply) => { 
    const { token, rideId } = request.params 
    const driver = (await query('SELECT id FROM drivers WHERE token_perfil = $1', [token])).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
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
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
    await query("UPDATE ride_messages SET lida = 1 WHERE ride_id = $1 AND remetente = 'passageiro' AND lida = 0", [rideId]) 
    return { success: true } 
  })

  // --- LOCALIZAÃ‡ÃƒO E ETA ---

  fastify.post('/api/motorista/:token/location', async (request, reply) => { 
    const { lat, lng, ride_id } = request.body 
    console.log('[LOCATION] Recebendo:', { lat, lng, ride_id, token: request.params.token }) 

    const driver = (await query( 
      'SELECT id FROM drivers WHERE token_perfil = $1', [request.params.token] 
    )).rows[0] 
    if (!driver) { 
      console.log('[LOCATION] Motorista nÃ£o encontrado') 
      return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
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

    // Salvar no histÃ³rico de rastreamento se passageiro embarcou 
    if (ride_id) { 
      const rideInfo = await query( 
        'SELECT id, passageiro_embarcou_at FROM rides WHERE id = $1 AND passageiro_embarcou_at IS NOT NULL', 
        [ride_id] 
      ) 
      if (rideInfo.rows.length > 0) { 
        await query( 
          'INSERT INTO ride_track (ride_id, lat, lng) VALUES ($1, $2, $3)', 
          [ride_id, lat, lng] 
        ) 
      } 
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
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
  
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
        foto_base64, ativo, created_at, aceitou_termos,
        balance_due, balance_due_blocked_at, balance_due_charge_pix,
        total_cancelamentos, tc_percentual, suspenso_tc
      FROM drivers WHERE token_perfil = $1
    `, [request.params.token]) 
    const driver = result.rows[0] 

    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 

    const corridasResult = await query(` 
      SELECT r.id, r.token, r.origem, r.destino, r.valor, r.valor_motorista, 
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

    const balance_due_bloqueado = parseFloat(driver.balance_due || 0) >= 30

    return {
      driver,
      corridas,
      comentarios,
      financeiro,
      balance_due: parseFloat(driver.balance_due || 0),
      balance_due_bloqueado,
      balance_due_charge_pix: driver.balance_due_charge_pix,
      balance_due_blocked_at: driver.balance_due_blocked_at,
      total_cancelamentos: driver.total_cancelamentos,
      tc_percentual: driver.tc_percentual,
      suspenso_tc: driver.suspenso_tc
    } 
  })

  fastify.get('/api/motorista/:token/extrato', async (request, reply) => {
    const driver = (await query('SELECT id FROM drivers WHERE token_perfil = $1', [request.params.token])).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' })

    const transacoes = (await query(`
      SELECT dt.id, dt.tipo, dt.descricao, dt.valor, dt.created_at, dt.ride_id, r.token as ride_token
      FROM driver_transactions dt
      LEFT JOIN rides r ON dt.ride_id = r.id
      WHERE dt.driver_id = $1
      ORDER BY dt.created_at ASC
    `, [driver.id])).rows

    let saldoTotal = 0
    const transacoesComSaldo = transacoes.map(t => {
      saldoTotal += parseFloat(t.valor)
      return {
        ...t,
        saldo_acumulado: saldoTotal
      }
    })

    return { transacoes: transacoesComSaldo, saldo_total: saldoTotal }
  })



  fastify.put('/api/motorista/:token/foto', async (request, reply) => { 
    const { foto_base64 } = request.body 
    if (!foto_base64) return reply.code(400).send({ error: 'Foto Ã© obrigatÃ³ria' }) 
    const driverResult = await query('SELECT id FROM drivers WHERE token_perfil = $1', [request.params.token]) 
    const driver = driverResult.rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
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
      AND (r.cancelado_por_driver_id IS NULL OR r.cancelado_por_driver_id != $1)
      ORDER BY r.created_at ASC
      LIMIT 1
    `, [driver.id])).rows[0] 
    return { corrida: corrida || null } 
  }) 

  fastify.get('/api/motorista/:token/corrida-ativa', async (request, reply) => { 
    const driver = (await query( 
      'SELECT id FROM drivers WHERE token_perfil = $1', 
      [request.params.token] 
    )).rows[0] 
    if (!driver) return { corrida: null } 

    // Primeiro, busca corrida ativa (nÃ£o concluÃ­da/cancelada)
    let corrida = (await query( 
      "SELECT * FROM rides WHERE driver_id = $1 AND status NOT IN ('concluida', 'cancelada') ORDER BY aceita_at DESC LIMIT 1", 
      [driver.id] 
    )).rows[0] 

    // Se nÃ£o houver corrida ativa, busca a Ãºltima concluÃ­da com pagamento pendente
    if (!corrida) {
      corrida = (await query( 
        "SELECT * FROM rides WHERE driver_id = $1 AND status = 'concluida' AND pagamento_status = 'aguardando_pagamento' ORDER BY id DESC LIMIT 1", 
        [driver.id] 
      )).rows[0]
    }

    if (!corrida) { 
      const dinheiroResult = await query( 
        `SELECT * FROM rides WHERE driver_id = $1 
         AND status = 'concluida' 
         AND forma_pagamento = '1' 
         AND pagamento_status NOT IN ('pago', 'nao_pago', 'cancelado') 
         AND updated_at >= NOW() - INTERVAL '5 minutes' 
         ORDER BY id DESC LIMIT 1`, 
        [driver.id] 
      ) 
      corrida = dinheiroResult.rows[0] || null 
    } 

    // Se nÃ£o hÃ¡ corrida aguardando pagamento, busca corrida paga recentemente (Ãºltimos 30 segundos)
    if (!corrida) {
      const recemPagaResult = await query(
        `SELECT * FROM rides WHERE driver_id = $1 
         AND status = 'concluida' 
         AND pagamento_status = 'pago' 
         AND updated_at >= NOW() - INTERVAL '30 seconds' 
         ORDER BY id DESC LIMIT 1`,
        [driver.id]
      )
      corrida = recemPagaResult.rows[0] || null
    }

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
    if (!result.rows.length) return reply.code(404).send({ error: 'Convite invÃ¡lido ou expirado' }) 
    return { valido: true } 
  }) 

  fastify.post('/api/cadastro-motorista/:token', async (request, reply) => { 
    const { token } = request.params 
    const { nome, telefone, modelo_carro, ano_carro, cor_carro, placa, foto_base64 } = request.body 
    const convite = (await query('SELECT * FROM convites WHERE token = $1 AND usado = false AND expira_em > NOW()', [token])).rows[0] 
    if (!convite) return reply.code(400).send({ error: 'Convite invÃ¡lido ou expirado' }) 
    const { v4: uuidv4 } = await import('uuid') 
    const tokenPerfil = uuidv4() 
    const result = await query(` 
      INSERT INTO drivers 
        (nome, telefone, modelo_carro, ano_carro, cor_carro, placa, 
         foto_base64, token_perfil, status_cadastro, ativo) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', 0) 
      RETURNING id 
    `, [nome, telefone, modelo_carro, ano_carro, cor_carro, placa, foto_base64 || null, tokenPerfil]) 
    const driverId = result.rows[0].id 
    await query('UPDATE convites SET usado = true, usado_em = NOW(), driver_id = $1 WHERE token = $2', [driverId, token]) 
    // telegram removido
    return { mensagem: 'Cadastro enviado com sucesso! Aguarde aprovaÃ§Ã£o.' } 
  })

  // --- AÃ‡Ã•ES DE CORRIDA ---

  fastify.post('/api/solicitar', async (request, reply) => { 
    const { 
      nome, celular, email, cpf,
      origem, origem_lat, origem_lng, 
      destino, destino_lat, destino_lng, 
      valor, tipo, agendada_para, 
      forma_pagamento 
    } = request.body 
    if (!origem || !destino || !valor || !celular) return reply.code(400).send({ error: 'Dados incompletos' })
    if (!cpf) { 
      return reply.code(400).send({ error: 'CPF Ã© obrigatÃ³rio para solicitar uma corrida.' }) 
    } 
    if (tipo === 'agendada') { 
      if (!agendada_para) { 
        return reply.code(400).send({ error: 'Data/hora do agendamento Ã© obrigatÃ³ria' }) 
      } 
      // Frontend envia sem timezone â€” interpretar como horÃ¡rio de BrasÃ­lia (UTC-3) 
      const agendadaParaDate = new Date(agendada_para + '-03:00') 
      const agora = new Date() 
      
      // DiferenÃ§a em horas 
      const diferencaHoras = (agendadaParaDate - agora) / (1000 * 60 * 60) 
      
      if (diferencaHoras < 2) { 
        return reply.code(400).send({ error: 'Agendamento deve ser com mÃ­nimo 2 horas de antecedÃªncia' }) 
      } 
      if (diferencaHoras > 15 * 24) { 
        return reply.code(400).send({ error: 'Agendamento deve ser com mÃ¡ximo 15 dias de antecedÃªncia' }) 
      } 
    } 
    const clientResult = await query('SELECT * FROM clients WHERE telefone = $1', [celular]) 
    let client = clientResult.rows[0] 
    if (client && client.ativo === false) { 
      return reply.code(403).send({ error: 'Sua conta estÃ¡ inativa. Entre em contato com o suporte MobiHub.' }) 
    }
    if (client && client.balance_due > 0) {
      return reply.code(400).send({ 
        error: 'VocÃª tem um dÃ©bito pendente. Regularize para solicitar uma nova corrida.', 
        link_pagamento: client.balance_due_charge_link 
      })
    }
    if (!client) { 
      const r = await query(`INSERT INTO clients (telefone, nome, email, cpf) VALUES ($1, $2, $3, $4) RETURNING id`, [celular, nome || null, email || null, cpf || null]) 
      client = { id: r.rows[0].id } 
    } else { 
      await query(`UPDATE clients SET nome = COALESCE($1, nome), email = COALESCE($2, email), cpf = COALESCE($3, cpf) WHERE id = $4`, [nome || null, email || null, cpf || null, client.id]) 
    }

    // Gravar aceite de termos automaticamente se nÃ£o tiver no banco
    if (client && !client.versao_termos) {
      await query(`
        UPDATE clients SET 
          aceitou_termos = true, 
          data_aceite_termos = CURRENT_TIMESTAMP, 
          ip_aceite_termos = $1, 
          versao_termos = '2.0', 
          aceite_responsabilidade = true 
        WHERE id = $2
      `, [request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip, client.id])
    } 
    // Check for referral discount
    let valorDesconto = 0
    let hasDesconto = false
    if (client && client.desconto_primeira_corrida > 0 && !client.desconto_usado) {
      valorDesconto = Math.min(client.desconto_primeira_corrida, valor) // Ensure discount doesn't exceed ride value
      hasDesconto = true
    }
    const valorFinal = Math.max(0, valor - valorDesconto)

    const { v4: uuidv4 } = await import('uuid') 
    const token = uuidv4() 
    const statusInicial = tipo === 'agendada' ? 'agendada' : 'aberta' 

    const splitRuleDefault = (await query( 
      "SELECT * FROM split_rules WHERE ativo = 1 AND com_lider = false ORDER BY id LIMIT 1" 
    )).rows[0] 
    const percentualMotoristaDefault = splitRuleDefault?.percentual_motorista || 82 
    // Calculate motorista share based on final discounted value
    const valorMotorista = parseFloat((valorFinal * percentualMotoristaDefault / 100).toFixed(2)) 
    const valorMobihub = parseFloat((valorFinal - valorMotorista).toFixed(2)) 
    
    let sinalValor = null
    let pixPayload = null
    let chargeId = null

    if (tipo === 'agendada') {
      sinalValor = parseFloat((valorFinal * 0.30).toFixed(2))
    }

    const result = await query(` 
      INSERT INTO rides (token, client_id, origem, origem_lat, origem_lng, destino, destino_lat, destino_lng, valor, valor_final, valor_motorista, valor_mobihub, tipo, agendada_para, status, forma_pagamento, sinal_valor, sinal_pago, desconto_aplicado) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id 
    `, [token, client.id, origem, origem_lat, origem_lng, destino, destino_lat, destino_lng, valor, valorFinal, valorMotorista, valorMobihub, tipo || 'normal', agendada_para || null, statusInicial, forma_pagamento || '1', sinalValor, false, valorDesconto])
    
    // Mark discount as used if applicable
    if (hasDesconto) {
      await query('UPDATE clients SET desconto_usado = true WHERE id = $1', [client.id])
    }
    const ride = (await query('SELECT * FROM rides WHERE id = $1', [result.rows[0].id])).rows[0] 

    // Verifica modo teste
    const opConfig = (await query('SELECT modo_teste FROM operacional_config LIMIT 1')).rows[0]
    if (opConfig?.modo_teste) {
      await query('UPDATE rides SET is_teste = true WHERE id = $1', [result.rows[0].id])
    }

    if (tipo === 'agendada') {
      try {
        // Gerar cobrança sinal via Zighu
        const gatewayConfig = (await query('SELECT * FROM gateway_config LIMIT 1')).rows[0]
        if (gatewayConfig?.ativo && gatewayConfig?.gateway === 'zighu') {
          try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 15000)
            const zighuRes = await fetch(`${gatewayConfig.url}/zighu/cobranca-sinal`, {
              signal: controller.signal,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': gatewayConfig.api_key
              },
              body: JSON.stringify({
                corrida_id: ride.id,
                valor: sinalValor,
                descricao: `Sinal agendamento MobiHub #${ride.id} - ${origem} â†’ ${destino}`,
                app_origem: 'mobihub'
              })
            })
            const zighuData = await zighuRes.json()
            clearTimeout(timeout)
            console.log('[ZIGHU SINAL] resposta:', JSON.stringify(zighuData))
            if (zighuData.pix_copia_cola) {
              await query(
                'UPDATE rides SET sinal_charge_id = $1, sinal_pix_payload = $2 WHERE id = $3',
                [zighuData.cobranca_id, zighuData.pix_copia_cola, ride.id]
              )
            }
          } catch(e) {
            console.log('[ZIGHU SINAL] Erro ao gerar QR:', e.message)
          }
        }
      } catch (err) {
        console.error('[SOLICITAR] Erro sinal:', err.message)
      }
    }

    // telegram removido

    // Emite nova corrida para todos os motoristas (apenas se normal)
    const io = getIo()
    if (io && (!tipo || tipo === 'normal')) {
      io.emit('nova_corrida', ride)
    }

    const response = { token, link: `${process.env.BASE_URL}/r/${token}`, mensagem: 'Corrida solicitada!' }
    if (tipo === 'agendada') {
      response.sinal_valor = sinalValor
      response.pix_payload = pixPayload
      response.agendada_para = agendada_para
    }
    return response 
  })

  fastify.put('/api/rides/:id/aceitar-motorista', async (request, reply) => { 
    const { token_motorista } = request.body 
    const { id } = request.params 
    const driver = (await query("SELECT * FROM drivers WHERE token_perfil = $1 AND ativo = 1 AND status_cadastro = 'aprovado'", [token_motorista])).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
    
    // Verificar bloqueio total por inadimplÃªncia
    if (driver.balance_due_blocked_at) {
      const blockedAt = new Date(driver.balance_due_blocked_at)
      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      if (blockedAt <= sevenDaysAgo) {
        return reply.code(403).send({ error: 'Seu acesso estÃ¡ bloqueado por inadimplÃªncia. Regularize seu saldo no painel.' })
      }
    }

    const ride = (await query("SELECT * FROM rides WHERE id = $1 AND status = 'aberta'", [id])).rows[0] 
    if (!ride) return reply.code(400).send({ error: 'Corrida nÃ£o disponÃ­vel' }) 
    await query("UPDATE rides SET status = 'aceita', driver_id = $1, aceita_at = CURRENT_TIMESTAMP WHERE id = $2", [driver.id, id]) 
    // telegram removido
    const io = getIo()
    if (io) {
      io.to(`ride:${id}`).emit('corrida:aceita', { token: ride.token, rideId: id, driver_id: driver.id })
      io.to(`ride:${id}`).emit('corrida:status_atualizado', { status: 'aceita', token: ride.token, rideId: id })
    }
    return { mensagem: 'Corrida aceita!', token: ride.token } 
  })

  // Motorista informa que o passageiro embarcou 
  fastify.post('/api/motorista/:token/embarcou/:rideId', async (request, reply) => { 
    const { token, rideId } = request.params 
    const driver = (await query('SELECT id FROM drivers WHERE token_perfil = $1', [token])).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 

    const ride = (await query('SELECT * FROM rides WHERE id = $1 AND driver_id = $2', [rideId, driver.id])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida nÃ£o encontrada' }) 

    // Busca motorista_chegou_at para calcular tempo de espera 
    const agora = new Date() 
    let tempoEsperaMin = 0 
    let custoEspera = 0 
    
    if (ride.motorista_chegou_at) { 
      const ms = agora - new Date(ride.motorista_chegou_at) 
      tempoEsperaMin = parseFloat((ms / 1000 / 60).toFixed(2)) 
    
      // Busca configuraÃ§Ãµes de espera 
      const configs = (await query('SELECT chave, valor FROM configuracoes')).rows 
      const config = {} 
      configs.forEach(c => config[c.chave] = c.valor) 
    
      const minutosGratis = parseFloat(config.espera_minutos_gratis || 5) 
      const valorMinuto = parseFloat(config.espera_valor_minuto || 0.60) 
    
      if (tempoEsperaMin > minutosGratis) { 
        const minutosExtras = tempoEsperaMin - minutosGratis 
        custoEspera = parseFloat((minutosExtras * valorMinuto).toFixed(2)) 
      } 
    
      console.log(`[EMBARQUE] Espera: ${tempoEsperaMin} min | Custo: R$${custoEspera}`) 
    } 
    
    await query(` 
      UPDATE rides SET 
        status = 'em_viagem', 
        status_detalhe = 'em_andamento', 
        passageiro_embarcou_at = CURRENT_TIMESTAMP, 
        tempo_espera_inicial_min = $2, 
        custo_espera_inicial = $3 
      WHERE id = $1 
    `, [rideId, tempoEsperaMin, custoEspera]) 
    
    return { success: true, mensagem: 'Passageiro embarcou!', tempo_espera_min: tempoEsperaMin, custo_espera: custoEspera } 
  }) 

  // Motorista informa que a corrida foi finalizada 
  fastify.put('/api/rides/:id/receber-dinheiro', async (request, reply) => {
    const { token_motorista } = request.body
    const { id } = request.params
    const driver = (await query('SELECT * FROM drivers WHERE token_perfil = $1', [token_motorista])).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' })
    const ride = (await query('SELECT * FROM rides WHERE id = $1 AND driver_id = $2', [id, driver.id])).rows[0]
    if (!ride) return reply.code(404).send({ error: 'Corrida nÃ£o encontrada' })

    const configLimite = (await query("SELECT valor FROM configuracoes WHERE chave = 'motorista_balance_due_limite'")).rows[0] 
    const limiteSaldoDevedor = parseFloat(configLimite?.valor || 30)

    await query("UPDATE rides SET pagamento_status = 'pago', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id])

    const temLider = !!driver.lider_id
    const splitRule = (await query(
      "SELECT * FROM split_rules WHERE ativo = 1 AND com_lider = $1 ORDER BY id LIMIT 1",
      [temLider]
    )).rows[0]

    const percentualPlataforma = splitRule?.percentual_plataforma || 15
    const valorFinal = ride.valor_final || ride.valor
    const valorPlataforma = parseFloat((valorFinal * percentualPlataforma / 100).toFixed(2))

    const updatedDriverResult = await query('UPDATE drivers SET balance_due = balance_due + $1 WHERE id = $2 RETURNING balance_due', [valorPlataforma, driver.id])
    const novoBalanceDue = parseFloat(updatedDriverResult.rows[0].balance_due)

    await query(
      'INSERT INTO driver_transactions (driver_id, ride_id, tipo, descricao, valor) VALUES ($1, $2, $3, $4, $5)',
      [driver.id, id, 'debito', `ComissÃ£o plataforma - corrida #${id} recebida em dinheiro`, -valorPlataforma]
    )

    let aviso = null
    if (novoBalanceDue >= limiteSaldoDevedor) {
      await query('UPDATE drivers SET balance_due_blocked_at = CURRENT_TIMESTAMP WHERE id = $1', [driver.id])
      aviso = 'Recebimento em dinheiro bloqueado. Use Pix ou CartÃ£o.'
    }

    return { mensagem: 'Pagamento recebido com sucesso!', valor_plataforma: valorPlataforma, aviso }
  })

  fastify.put('/api/rides/:id/passageiro-nao-pagou', async (request, reply) => {
    const { token_motorista } = request.body
    const { id } = request.params
    const driver = (await query('SELECT * FROM drivers WHERE token_perfil = $1', [token_motorista])).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' })
    const ride = (await query('SELECT * FROM rides WHERE id = $1 AND driver_id = $2', [id, driver.id])).rows[0]
    if (!ride) return reply.code(404).send({ error: 'Corrida nÃ£o encontrada' })

    // 1. Registrar ocorrÃªncia (apenas log sem impacto financeiro no motorista)
    await query("UPDATE rides SET pagamento_status = 'nao_pago', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id])

    // 2. Bloquear passageiro somando valor da corrida ao balance_due do cliente
    const valorCorrida = parseFloat(ride.valor_final || ride.valor)
    await query('UPDATE clients SET balance_due = balance_due + $1 WHERE id = $2', [valorCorrida, ride.client_id])

    // 3. Gerar cobranÃ§a no Asaas para o passageiro pagar
    const clientResult = await query('SELECT * FROM clients WHERE id = $1', [ride.client_id])
    const client = clientResult.rows[0]
    let asaasCustomerId = client?.asaas_customer_id

    if (!asaasCustomerId && client) {
      const customerResponse = await fetch('https://www.asaas.com/api/v3/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'access_token': process.env.ASAAS_API_KEY },
        body: JSON.stringify({
          name: client.nome || 'Passageiro',
          mobilePhone: client.telefone?.replace(/\D/g, ''),
          externalReference: String(client.id)
        })
      })
      const customerData = await customerResponse.json()
      if (customerData.id) {
        asaasCustomerId = customerData.id
        await query('UPDATE clients SET asaas_customer_id = $1 WHERE id = $2', [customerData.id, client.id])
      }
    }

    if (client) {
      const cobrancaResponse = await fetch('https://www.asaas.com/api/v3/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'access_token': process.env.ASAAS_API_KEY },
        body: JSON.stringify({
          billingType: 'UNDEFINED',
          value: valorCorrida,
          dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          description: `Corrida #${id} - MobiHub - Regularize para voltar a solicitar corridas`,
          externalReference: `client_${ride.client_id}_ride_${id}`,
          customer: asaasCustomerId
        })
      })
      const cobrancaData = await cobrancaResponse.json()
      if (cobrancaData.id) {
        await query(
          'UPDATE clients SET balance_due_charge_id = $1, balance_due_charge_link = $2 WHERE id = $3',
          [cobrancaData.id, cobrancaData.invoiceUrl, ride.client_id]
        )
      }
    }

    return { mensagem: 'Registro de nÃ£o pagamento realizado!' }
  })

  fastify.put('/api/rides/:id/finalizar-motorista', async (request, reply) => { 
    const { token_motorista } = request.body 
    const { id } = request.params 
    const driver = (await query('SELECT * FROM drivers WHERE token_perfil = $1', [token_motorista])).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
    const ride = (await query(` 
      SELECT id, valor, valor_motorista, custo_espera_inicial, custo_paradas, 
        num_paradas, tempo_espera_inicial_min, tempo_paradas_total_min, 
        origem, destino, client_id, token, forma_pagamento,
        origem_lat, origem_lng, destino_lat, destino_lng, status
      FROM rides 
      WHERE id = $1 AND driver_id = $2 
    `, [id, driver.id])).rows[0] 
    if (!ride) return reply.code(400).send({ error: 'Corrida nÃ£o encontrada' })
    
    // Verificar se corrida jÃ¡ foi finalizada 
    if (ride.status === 'concluida') { 
      return reply.code(400).send({ error: 'Corrida jÃ¡ foi finalizada' }) 
    }
    
    if (ride.status !== 'aceita' && ride.status !== 'em_viagem') {
      return reply.code(400).send({ error: 'Corrida nÃ£o estÃ¡ em andamento' }) 
    } 
    const { calculateTotalRideCost, calculateInitialWaitCost } = await import('../billing.js') 
    const configs = (await query('SELECT chave, valor FROM configuracoes')).rows 
    const config = {} 
    configs.forEach(c => config[c.chave] = c.valor) 

    // Buscar tarifa ativa para o horÃ¡rio de criaÃ§Ã£o da corrida 
    const agora = new Date() 
    const diaSemana = agora.getDay() // 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sab 
    const horaAtual = agora.getHours() * 60 + agora.getMinutes() 
 
    const tarifas = (await query('SELECT * FROM tarifas WHERE ativo = 1')).rows 
 
    let tarifaAtiva = null 

    // Verificar se hoje Ã© feriado
    const hoje = agora.toISOString().split('T')[0]
    const feriadoHoje = (await query(
      "SELECT * FROM feriados WHERE data = $1 LIMIT 1",
      [hoje]
    )).rows[0]

    if (feriadoHoje) {
      // Verificar se hora atual estÃ¡ dentro do horÃ¡rio do feriado
      let feriadoAtivo = true
      if (feriadoHoje.horario_inicio && feriadoHoje.horario_fim) {
        const [hIni, mIni] = feriadoHoje.horario_inicio.split(':').map(Number)
        const [hFim, mFim] = feriadoHoje.horario_fim.split(':').map(Number)
        const inicio = hIni * 60 + mIni
        const fim = hFim * 60 + mFim
        feriadoAtivo = fim < inicio
          ? (horaAtual >= inicio || horaAtual < fim)
          : (horaAtual >= inicio && horaAtual <= fim)
      }

      if (feriadoAtivo) {
        if (feriadoHoje.valor_minimo && feriadoHoje.valor_km) {
          tarifaAtiva = {
            valor_minimo: feriadoHoje.valor_minimo,
            valor_km: feriadoHoje.valor_km,
            km_minimo: feriadoHoje.km_minimo || 7.5,
            nome: feriadoHoje.nome
          }
        } else {
          const tarifaFeriado = (await query(
            "SELECT * FROM tarifas WHERE aplicar_feriados = true AND ativo = 1 LIMIT 1"
          )).rows[0]
          if (tarifaFeriado) tarifaAtiva = tarifaFeriado
        }
      }
    }

    for (const t of tarifas) { 
      const dias = String(t.dias).split(',').map(Number) 
      if (!dias.includes(diaSemana)) continue 
      const [hIni, mIni] = t.hora_inicio.split(':').map(Number) 
      const [hFim, mFim] = t.hora_fim.split(':').map(Number) 
      const inicio = hIni * 60 + mIni 
      const fim = hFim * 60 + mFim 
      // Suporte a tarifas que cruzam meia-noite (ex: 20:00 - 06:00) 
      const ativa = fim < inicio 
        ? (horaAtual >= inicio || horaAtual < fim) 
        : (horaAtual >= inicio && horaAtual < fim) 
      if (ativa) { tarifaAtiva = t; break } 
    } 
 
    let valorBase = parseFloat(ride.valor || 15)
    console.log(`[BILLING] Usando valor aprovado pelo passageiro: R$${valorBase}`)

    // Calcular km reais percorridos com passageiro embarcado 
    const trackPoints = (await query( 
      'SELECT lat, lng FROM ride_track WHERE ride_id = $1 ORDER BY created_at ASC', 
      [id] 
    )).rows 
    
    let kmReais = 0 
    if (trackPoints.length >= 2) { 
      for (let i = 1; i < trackPoints.length; i++) { 
        const p1 = trackPoints[i - 1] 
        const p2 = trackPoints[i] 
        const R = 6371 
        const dLat = (p2.lat - p1.lat) * Math.PI / 180 
        const dLng = (p2.lng - p1.lng) * Math.PI / 180 
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
          Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * 
          Math.sin(dLng/2) * Math.sin(dLng/2) 
        kmReais += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) 
      } 
      kmReais = parseFloat(kmReais.toFixed(2)) 
      console.log(`[TAXIMETRO] Km reais percorridos: ${kmReais}km`) 
    } 
    
    // Se tiver km reais, recalcular valor base pela tarifa 
    if (kmReais > 0 && tarifaAtiva) { 
      const kmMin = parseFloat(tarifaAtiva.km_minimo || 7.5) 
      const valorMin = parseFloat(tarifaAtiva.valor_minimo || 15) 
      const valorKm = parseFloat(tarifaAtiva.valor_km || 2) 
      const novoValorBase = kmReais <= kmMin 
        ? valorMin 
        : parseFloat((valorMin + (kmReais - kmMin) * valorKm).toFixed(2)) 
      
      console.log(`[TAXIMETRO] Valor base recalculado: R$${novoValorBase} (${kmReais}km Ã— tarifa ${tarifaAtiva.nome || 'atual'})`) 
      valorBase = novoValorBase 
    } 
    
    // Salvar km_reais na corrida 
    await query('UPDATE rides SET km_reais = $1 WHERE id = $2', [kmReais || null, id]) 

    // Buscar regra de split ativa baseada se o motorista tem lÃ­der
    const temLider = !!driver.lider_id
    const splitRule = (await query( 
      "SELECT * FROM split_rules WHERE ativo = 1 AND com_lider = $1 ORDER BY id LIMIT 1", 
      [temLider] 
    )).rows[0] 

    const percentualLider = temLider ? (splitRule?.percentual_lider ?? 0) : 0 

    // Cálculo detalhado para memória de cálculo 
    const waitInfo = calculateInitialWaitCost(ride.tempo_espera_inicial_min || 0, config) 
    const valorFinal = calculateTotalRideCost(valorBase, waitInfo.cost, ride.custo_paradas || 0, config) 
 
    // Split em duas faixas usando valor_minimo da tarifa como limite 
    const { calcularSplitFaixas, getH3Id } = await import('../h3split.js') 
    const splitH3 = await calcularSplitFaixas(valorFinal, tarifaAtiva, temLider) 
    const h3Id = getH3Id(ride.origem_lat, ride.origem_lng) 
 
    let valorMotorista = splitH3.motorista_total 
    let valorPlataforma = splitH3.plataforma_total 
    const valorLider = splitH3.lider_total
 
    console.log(`[SPLIT H3] ${h3Id} | Total: R$${valorFinal} | Limite: R$${tarifaAtiva?.valor_minimo || 0} | Motorista: R$${valorMotorista} | Plataforma: R$${valorPlataforma} | Líder: R$${valorLider}`)

    // Verificar e aplicar abatimento de saldo devedor (ANTES do split do Asaas!)
    let abatimento = 0
    let balance_due_novo = 0
    const formaPagamento = ride.forma_pagamento
    const corridaPix = formaPagamento == 2 || formaPagamento == 3 || formaPagamento === '2' || formaPagamento === '3'

    if 
    (corridaPix) {
      // 1. Ler saldo devedor ATUAL do banco (valor real)
      const driverInfo = await query('SELECT balance_due FROM drivers WHERE id = $1', [driver.id])
      const balance_due_atual = parseFloat(driverInfo.rows[0]?.balance_due || 0)

      if (balance_due_atual > 0) {
        // 2. Calcular abatimento correto
        abatimento = parseFloat(Math.min(balance_due_atual, valorMotorista).toFixed(2))
        
        const existingTransacao = await query(
          'SELECT id FROM driver_transactions WHERE driver_id = $1 AND ride_id = $2 AND tipo = $3',
          [driver.id, id, 'credito']
        )
        
        if (existingTransacao.rows.length === 0) {
          // 3. Atualizar banco
          await query('UPDATE drivers SET balance_due = GREATEST(0, balance_due - $1) WHERE id = $2', [abatimento, driver.id])
          
          // 4. Registrar transaÃ§Ã£o
          await query('INSERT INTO driver_transactions (driver_id, ride_id, tipo, descricao, valor) VALUES ($1, $2, $3, $4, $5)', 
            [driver.id, id, 'credito', `Abatimento saldo devedor - corrida #${id}`, abatimento])
          
          balance_due_novo = parseFloat(Math.max(0, balance_due_atual - abatimento).toFixed(2))
          valorMotorista = parseFloat((valorMotorista - abatimento).toFixed(2))
          
          if (balance_due_novo <= 0) {
            await query('UPDATE drivers SET balance_due_blocked_at = NULL WHERE id = $1', [driver.id])
          }
        }
      }
    }

    // Gerar cobranÃ§a Pix via Zighu
    let zighuPaymentId = null, zighuPaymentLink = null, zighuPixPayload = null
    if ((ride.forma_pagamento === '2' || ride.forma_pagamento === 2)) { 
      try { 
        const gatewayConfig = (await query('SELECT * FROM gateway_config LIMIT 1')).rows[0]

        if (gatewayConfig?.ativo && gatewayConfig?.gateway === 'zighu') {
          try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 15000)
            const zighuRes = await fetch(`${gatewayConfig.url}/zighu/cobranca`, {
              signal: controller.signal,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': gatewayConfig.api_key
              },
              body: JSON.stringify({
                corrida_id: id,
                valor: valorFinal,
                motorista_id: driver.id,
                chave_pix: driver.chave_pix,
                percentual_motorista: Math.round(splitH3.percentuais.motorista),
                app_origem: 'mobihub'
              })
            })
            const zighuData = await zighuRes.json()
            clearTimeout(timeout)
            console.log('[ZIGHU] resposta:', JSON.stringify(zighuData))
            if (zighuData.pix_copia_cola) {
              zighuPixPayload = zighuData.pix_copia_cola
              zighuPaymentId = zighuData.cobranca_id
              await query(
                'UPDATE rides SET zighu_payment_id = $1, zighu_pix_payload = $2, zighu_pix_qrcode = $3, pagamento_status = $4 WHERE id = $5',
                [String(zighuData.cobranca_id), zighuData.pix_copia_cola, zighuData.qr_code, 'aguardando_pagamento', id]
              )
            }
          } catch(e) {
            console.log('[ZIGHU] Erro ao gerar QR:', e.message)
          }
        }
      } catch (err) { 
        console.error('[ZIGHU PIX] Erro ao gerar cobranÃ§a:', err) 
      } 
    }

    // Pagamento por crÃ©ditos se forma_pagamento = 4
    if ((ride.forma_pagamento === '4' || ride.forma_pagamento === 4)) {
      const clientResult = await query('SELECT * FROM clients WHERE id = $1', [ride.client_id])
      const client = clientResult.rows[0]
      const creditos = parseFloat(client?.creditos || 0)

      if (creditos >= valorFinal) {
        await query('UPDATE clients SET creditos = creditos - $1 WHERE id = $2', [valorFinal, ride.client_id])
        await query("UPDATE rides SET pagamento_status = 'pago' WHERE id = $1", [id])
      } else {
        await query("UPDATE rides SET pagamento_status = 'aguardando_pagamento' WHERE id = $1", [id])
      }
    }

    await query(` 
      UPDATE rides SET 
        status = 'concluida', 
        concluida_at = CURRENT_TIMESTAMP, 
        updated_at = CURRENT_TIMESTAMP,
        valor_final = $1, 
        valor_motorista = $2, 
        valor_mobihub = $3, 
        valor_lider = $4,
        base_value = $5, 
        wait_extra_minutes = $6, 
        wait_extra_charge = $7, 
        stop_extra_minutes = $8, 
        stop_extra_charge = $9, 
        total_value = $10 
      WHERE id = $11 
    `, [
      valorFinal,
      valorMotorista,
      valorPlataforma, 
      valorLider,
      valorBase, 
      waitInfo.extraMinutes, 
      waitInfo.cost, 
      ride.tempo_paradas_total_min || 0, 
      ride.custo_paradas || 0, 
      valorFinal, 
      id 
    ]) 
    
    const dadosHash = `${id}|${ride.client_id || ''}|${driver.id}|${ride.origem}|${ride.destino}|${valorFinal}|${new Date().toISOString()}` 
    const hash = crypto.createHash('sha256').update(dadosHash).digest('hex') 
    await query('UPDATE rides SET hash_sha256 = $1 WHERE id = $2', [hash, id])
    
    // Salva h3_id e split_detalhes 
    await query('UPDATE rides SET h3_id = $1, split_detalhes = $2 WHERE id = $3', 
      [h3Id, JSON.stringify(splitH3), id]) 
    
    await query('UPDATE drivers SET total_viagens = total_viagens + 1 WHERE id = $1', [driver.id]) 
    if (ride.client_id) {
      await query('UPDATE clients SET total_corridas = total_corridas + 1 WHERE id = $1', [ride.client_id])
      
      // Check for referral and handle bonus
      const indicacaoResult = await query('SELECT * FROM indicacoes WHERE client_id = $1 AND bonus_liberado = false', [ride.client_id])
      if (indicacaoResult.rows.length > 0) {
        const indicacao = indicacaoResult.rows[0]
        // Increment corridas_completadas
        await query('UPDATE indicacoes SET corridas_completadas = corridas_completadas + 1 WHERE id = $1', [indicacao.id])
        // Get referral config
        const config = (await query('SELECT * FROM indicacao_config LIMIT 1')).rows[0]
        if (config) {
          const updatedIndicacao = (await query('SELECT * FROM indicacoes WHERE id = $1', [indicacao.id])).rows[0]
          if (updatedIndicacao.corridas_completadas >= config.min_corridas_liberar) {
            // Release bonus!
            await query(`
              UPDATE indicacoes 
              SET bonus_liberado = true, bonus_valor = $1 
              WHERE id = $2
            `, [config.bonus_motorista, indicacao.id])
            
            // Add bonus to driver's transactions
            await query(`
              INSERT INTO driver_transactions (driver_id, tipo, descricao, valor, created_at)
              VALUES ($1, 'credito', $2, $3, CURRENT_TIMESTAMP)
            `, [indicacao.driver_id, `BÃ´nus indicaÃ§Ã£o passageiro #${ride.client_id}`, config.bonus_motorista])
            
            // Update driver's credits if needed (depending on how your system works)
            // For now, just log it
            console.log(`[REFERRAL] Bonus R$${config.bonus_motorista} released to driver #${indicacao.driver_id}`)
          }
        }
      }
    }

    // Emitir evento para passageiro com Pix copia e cola
    const io = getIo()
    if (io && zighuPixPayload) {
      io.to(`ride:${id}`).emit('corrida:aguardando_pagamento', { 
        corrida_id: id, 
        pix_copia_cola: zighuPixPayload, 
        valor: valorFinal 
      })
    }

    // Disparar webhook de corrida finalizada 
    try { 
      const { dispararWebhook } = await import('../webhook.js') 
      const driverInfo = (await query( 
        'SELECT id, nome, token_perfil, lider_id, codigo_indicacao, balance_due FROM drivers WHERE id = $1', 
        [driver.id] 
      )).rows[0]

      const balance_due_atual = parseFloat(driverInfo?.balance_due || 0)
      balance_due_novo = balance_due_atual

      await dispararWebhook('corrida.finalizada', { 
        corrida_id: id, 
        corrida_token: ride.token || null, 
        valor_total: valorFinal, 
        valor_motorista: valorMotorista, 
        valor_plataforma: valorPlataforma, 
        valor_lider: valorLider,
        balance_due_novo,
        motorista_id: driver.id, 
        motorista_nome: driverInfo?.nome, 
        motorista_token: driverInfo?.token_perfil, 
        lider_id: driverInfo?.lider_id || null, 
        forma_pagamento: ride.forma_pagamento || '1',
        zighu_payment_id: zighuPaymentId,
        zighu_payment_link: zighuPaymentLink,
        zighu_pix_payload: zighuPixPayload,
        split: {
          faixa1: splitH3.faixa1,
          faixa2: splitH3.faixa2,
          motorista_total: splitH3.motorista_total,
          plataforma_total: splitH3.plataforma_total,
          valor_limite: splitH3.valor_limite,
          teve_excedente: splitH3.teve_excedente,
          percentual_lider: percentualLider
        }, 
        finalizada_at: new Date().toISOString() 
      }) 
    } catch(e) { 
      console.error('[WEBHOOK] Erro:', e.message) 
    } 

    // telegram removido
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
    if (!ride) return reply.code(404).send({ error: 'Corrida nÃ£o pode ser cancelada' }) 
  
    // NÃ£o pode cancelar se passageiro jÃ¡ embarcou 
    if (ride.passageiro_embarcou_at) { 
      return reply.code(400).send({ error: 'NÃ£o Ã© possÃ­vel cancelar apÃ³s embarque' }) 
    } 
  
    await query(` 
      UPDATE rides SET 
        status = 'cancelada', 
        cancelada_at = CURRENT_TIMESTAMP, 
        status_detalhe = 'cancelada_passageiro' 
      WHERE id = $1 
    `, [ride.id]) 
  
    // telegram removido
  
    // Emite evento socket.io
    const io = getIo()
    if (io) {
      io.to(`ride:${ride.id}`).emit('corrida:status_atualizado', { status: 'cancelada', token: ride.token, rideId: ride.id })
    }
  
    return { mensagem: 'Corrida cancelada' } 
  })

  fastify.put('/api/motorista/:token/cancelar-corrida/:rideId', async (request, reply) => {
    const { token, rideId } = request.params
    const { motivo_codigo } = request.body || {}
    const driver = (await query('SELECT id FROM drivers WHERE token_perfil = $1', [token])).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' })
    const ride = (await query("SELECT * FROM rides WHERE id = $1 AND driver_id = $2 AND status IN ('aceita', 'aberta')", [rideId, driver.id])).rows[0]
    if (!ride) {
      const existe = (await query('SELECT status FROM rides WHERE id = $1', [rideId])).rows[0]
      if (existe) return reply.code(400).send({ error: `NÃ£o Ã© possÃ­vel cancelar corrida com status: ${existe.status}` })
      return reply.code(404).send({ error: 'Corrida nÃ£o encontrada' })
    }
    if (ride.passageiro_embarcou_at) return reply.code(400).send({ error: 'NÃ£o Ã© possÃ­vel cancelar apÃ³s embarque do passageiro' })
    if (!motivo_codigo) return reply.code(400).send({ error: 'Motivo do cancelamento Ã© obrigatÃ³rio' })
    const motivo = (await query('SELECT * FROM cancelamento_motivos WHERE codigo = $1 AND ativo = true', [motivo_codigo])).rows[0]
    if (!motivo) return reply.code(400).send({ error: 'Motivo invÃ¡lido' })
    const config = (await query('SELECT * FROM cancelamento_config LIMIT 1')).rows[0]
    let taxa_cobrada = false
    let taxa_valor = 0
    if (motivo.permite_taxa && motivo.requer_tempo_espera && ride.motorista_chegou_at) {
      const minutos = (Date.now() - new Date(ride.motorista_chegou_at).getTime()) / 60000
      if (minutos >= (config?.tempo_espera_minutos || 5)) {
        taxa_valor = config?.taxa_cancelamento_valor || 5.00
        taxa_cobrada = true
      }
    }
    await query(`UPDATE rides SET status = 'cancelada', cancelada_at = CURRENT_TIMESTAMP, status_detalhe = 'cancelada_motorista', motivo_cancelamento = $1, taxa_cancelamento = $2, taxa_cancel_cobrada = $3, cancelado_por = 'motorista' WHERE id = $4`, [motivo_codigo, taxa_valor, taxa_cobrada, rideId])
    if (!motivo.permite_taxa || !taxa_cobrada) {
      await query('UPDATE drivers SET total_cancelamentos = total_cancelamentos + 1 WHERE id = $1', [driver.id])
      const stats = (await query(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'cancelada' AND status_detalhe = 'cancelada_motorista' AND (motivo_cancelamento IS NULL OR motivo_cancelamento NOT IN ('passageiro_nao_apareceu')) THEN 1 ELSE 0 END) as cancels FROM rides WHERE driver_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`, [driver.id])).rows[0]
      const tc = parseFloat(stats.total) > 0 ? parseFloat((parseFloat(stats.cancels) / parseFloat(stats.total) * 100).toFixed(1)) : 0
      await query('UPDATE drivers SET tc_percentual = $1, tc_ultima_atualizacao = NOW() WHERE id = $2', [tc, driver.id])
      const tcLimite = config?.tc_limite_percentual || 15
      if (config?.suspensao_automatica && tc >= tcLimite) {
        await query('UPDATE drivers SET suspenso_tc = true WHERE id = $1', [driver.id])
      }
    }
    // telegram removido

    // Reabre a corrida para outros motoristas (exclui o motorista que cancelou)
    const { v4: uuidv4 } = await import('uuid')
    const novoToken = uuidv4()
    const novaCorreida = await query(`
      INSERT INTO rides (token, client_id, origem, origem_lat, origem_lng, destino, destino_lat, destino_lng, valor, valor_motorista, valor_mobihub, tipo, forma_pagamento, status)
      SELECT $1, client_id, origem, origem_lat, origem_lng, destino, destino_lat, destino_lng, valor, valor_motorista, valor_mobihub, tipo, forma_pagamento, 'aberta'
      FROM rides WHERE id = $2
      RETURNING id, token
    `, [novoToken, rideId])

    const novaRide = novaCorreida.rows[0]

    // Salva motorista que cancelou para excluir das ofertas
    await query('UPDATE rides SET cancelado_por_driver_id = $1 WHERE id = $2', [driver.id, novaRide.id])

    // telegram removido

    const io = getIo()
    if (io) {
      io.to(`ride:${rideId}`).emit('corrida:status_atualizado', { status: 'cancelada', token: ride.token, rideId, nova_corrida_token: novaRide.token })
      io.emit('nova_corrida', (await query('SELECT * FROM rides WHERE id = $1', [novaRide.id])).rows[0])
    }
    return { mensagem: 'Corrida cancelada com sucesso', taxa_cobrada, taxa_valor, nova_corrida_token: novaRide.token }
  })

  fastify.get('/api/cancelamento/motivos', async (request, reply) => {
    const motivos = (await query('SELECT codigo, descricao, permite_taxa, requer_tempo_espera FROM cancelamento_motivos WHERE ativo = true ORDER BY ordem')).rows
    return { motivos }
  })

  fastify.get('/api/admin/cancelamento-config', { preHandler: requireAuth }, async () => {
    const config = (await query('SELECT * FROM cancelamento_config LIMIT 1')).rows[0]
    const motivos = (await query('SELECT * FROM cancelamento_motivos ORDER BY ordem')).rows
    return { config, motivos }
  })

  fastify.put('/api/admin/cancelamento-config', { preHandler: requireAuth }, async (request, reply) => {
    const { tempo_espera_minutos, taxa_cancelamento_valor, tc_limite_percentual, tc_janela_corridas, suspensao_automatica } = request.body
    await query(`UPDATE cancelamento_config SET tempo_espera_minutos=$1, taxa_cancelamento_valor=$2, tc_limite_percentual=$3, tc_janela_corridas=$4, suspensao_automatica=$5, updated_at=NOW() WHERE id=1`, [tempo_espera_minutos, taxa_cancelamento_valor, tc_limite_percentual, tc_janela_corridas, suspensao_automatica])
    return { success: true }
  })



  // --- REPUTAÃ‡ÃƒO E AVALIAÃ‡Ã•ES ---

  fastify.post('/api/ride/:token/avaliar-motorista', async (request, reply) => { 
    const { estrelas, comentario } = request.body 
    if (!estrelas || estrelas < 1 || estrelas > 5) return reply.code(400).send({ error: '1-5 estrelas' }) 
    const ride = (await query('SELECT * FROM rides WHERE token = $1', [request.params.token])).rows[0] 
    if (!ride || ride.status !== 'concluida') return reply.code(400).send({ error: 'Corrida invÃ¡lida' }) 
    const existing = (await query('SELECT * FROM ratings WHERE ride_id = $1', [ride.id])).rows[0] 
    if (existing?.estrelas_motorista) return reply.code(409).send({ error: 'JÃ¡ avaliado' }) 
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

  // Rota removida: /api/internal/rate-client (depende de Telegram, que foi descontinuado)

  fastify.get('/api/reputacao/corrida/:id', { preHandler: requireAuth }, async (request, reply) => { 
    const ride = (await query(`SELECT r.*, d.nome as driver_nome, d.media_avaliacao as driver_media, c.nome as client_nome FROM rides r LEFT JOIN drivers d ON r.driver_id = d.id LEFT JOIN clients c ON r.client_id = c.id WHERE r.id = $1`, [request.params.id])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'NÃ£o encontrada' }) 
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

    if (!ride) return reply.code(404).send({ error: 'Corrida nÃ£o encontrada' }) 
    return ride 
  }) 

  // Buscar corrida pelo token (melhorado para incluir campos de billing) 
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

    if (!ride) return reply.code(404).send({ error: 'Corrida nÃ£o encontrada' }) 
    const rating = (await query('SELECT estrelas_motorista, comentario_cliente, avaliado_em_cliente FROM ratings WHERE ride_id = $1', [ride.id])).rows[0] 
    const paradas = (await query('SELECT duracao_min, custo, iniciada_at, finalizada_at FROM ride_stops WHERE ride_id = $1 ORDER BY iniciada_at', [ride.id])).rows 
    const configs = (await query('SELECT chave, valor FROM configuracoes')).rows 
    const config = {} 
    configs.forEach(c => config[c.chave] = c.valor)

    delete ride.client_id 
    delete ride.driver_id

    return { ride, rating, paradas, config } 
  })

  fastify.get('/api/reputacao/geral', { preHandler: requireAuth }, async () => {
    const mediaMotoristasResult = await query(`
      SELECT ROUND(AVG(estrelas_motorista)::numeric, 1) as media, COUNT(*) as total
      FROM ratings WHERE estrelas_motorista IS NOT NULL
    `)
    const mediaMotoristas = mediaMotoristasResult.rows[0]

    const mediaClientesResult = await query(`
      SELECT ROUND(AVG(estrelas_cliente)::numeric, 1) as media, COUNT(*) as total
      FROM ratings WHERE estrelas_cliente IS NOT NULL
    `)
    const mediaClientes = mediaClientesResult.rows[0]

    const topMotoristasResult = await query(`
      SELECT d.id, d.nome, d.total_viagens, d.media_avaliacao, d.total_avaliacoes
      FROM drivers d WHERE d.status_cadastro = 'aprovado' AND d.total_avaliacoes > 0
      ORDER BY d.media_avaliacao DESC, d.total_viagens DESC LIMIT 10
    `)
    const topMotoristas = topMotoristasResult.rows

    const clientesProblematicosResult = await query(`
      SELECT c.id, c.nome, c.telefone, c.total_corridas, c.media_avaliacao, c.total_avaliacoes
      FROM clients c WHERE c.media_avaliacao < 3 AND c.total_avaliacoes >= 2
      ORDER BY c.media_avaliacao ASC, c.total_corridas DESC
    `)
    const clientesProblematicos = clientesProblematicosResult.rows

    return {
      mediaMotoristas: { media: parseFloat(mediaMotoristas.media || 0), total: parseInt(mediaMotoristas.total || 0) },
      mediaClientes: { media: parseFloat(mediaClientes.media || 0), total: parseInt(mediaClientes.total || 0) },
      topMotoristas,
      clientesProblematicos
    }
  })

  fastify.get('/api/reputacao/motorista/:id', { preHandler: requireAuth }, async (request) => {
    const driver = (await query(`
      SELECT id, nome, total_viagens, media_avaliacao, total_avaliacoes
      FROM drivers WHERE id = $1
    `, [request.params.id])).rows[0]

    const avaliacoes = (await query(`
      SELECT r.estrelas_motorista, r.comentario_cliente, r.avaliado_em_cliente, 
        rd.origem, rd.destino, rd.created_at as corrida_data, c.nome as client_nome
      FROM ratings r
      JOIN rides rd ON r.ride_id = rd.id
      LEFT JOIN clients c ON rd.client_id = c.id
      WHERE rd.driver_id = $1 AND r.estrelas_motorista IS NOT NULL
      ORDER BY r.avaliado_em_cliente DESC LIMIT 30
    `, [request.params.id])).rows

    return { driver, avaliacoes }
  })

  // Fix: restaurar rotas de reputaÃ§Ã£o
  fastify.get('/api/reputacao/cliente/:id', { preHandler: requireAuth }, async (request) => {
    const client = (await query(`
      SELECT id, nome, telefone, total_corridas, media_avaliacao, total_avaliacoes
      FROM clients WHERE id = $1
    `, [request.params.id])).rows[0]

    const avaliacoes = (await query(`
      SELECT r.estrelas_cliente, r.comentario_motorista, r.avaliado_em_motorista, 
        rd.origem, rd.destino, rd.created_at as corrida_data, d.nome as driver_nome
      FROM ratings r
      JOIN rides rd ON r.ride_id = rd.id
      LEFT JOIN drivers d ON rd.driver_id = d.id
      WHERE rd.client_id = $1 AND r.estrelas_cliente IS NOT NULL
      ORDER BY r.avaliado_em_motorista DESC LIMIT 30
    `, [request.params.id])).rows

    return { client, avaliacoes }
  })

  // Novas rotas
  fastify.get('/api/my-rides', async (request, reply) => {
    const { telefone } = request.query
    if (!telefone) return reply.code(400).send({ error: 'Telefone obrigatÃ³rio' })
    const client = (await query('SELECT id FROM clients WHERE telefone = $1', [telefone])).rows[0]
    if (!client) return { rides: [] }
    const rides = (await query(`
      SELECT id, token, origem, destino, origem_lat, origem_lng, destino_lat, destino_lng, created_at, status, valor, forma_pagamento
      FROM rides
      WHERE client_id = $1
      ORDER BY created_at DESC
      LIMIT 5
    `, [client.id])).rows
    return { rides }
  })

  fastify.get('/api/clients', { preHandler: requireAuth }, async () => {
    const result = await query(`
      SELECT id, nome, telefone, total_corridas, media_avaliacao, total_avaliacoes, balance_due
      FROM clients ORDER BY nome
    `)
    return result.rows
  })

  fastify.post('/api/admin/clients/:id/zerar-saldo', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    await query('UPDATE clients SET balance_due = 0, balance_due_charge_id = NULL, balance_due_charge_link = NULL WHERE id = $1', [id]) 
    return { mensagem: 'Saldo devedor zerado com sucesso!' } 
  })





  fastify.put('/api/clients/:telefone', async (request, reply) => {
    const { telefone } = request.params
    const { nome, cpf } = request.body

    const clientResult = await query('SELECT * FROM clients WHERE telefone = $1', [telefone])
    const client = clientResult.rows[0]

    if (!client) return reply.code(404).send({ error: 'Cliente nÃ£o encontrado' })

    await query(
      `UPDATE clients SET nome = COALESCE($1, nome), cpf = COALESCE($2, cpf) WHERE id = $3`,
      [nome || null, cpf || null, client.id]
    )

    return { mensagem: 'Dados atualizados com sucesso!' }
  })

  fastify.get('/api/client/reputation', async (request, reply) => {
    const { telefone } = request.query
    if (!telefone) return reply.code(400).send({ error: 'Telefone obrigatÃ³rio' })
    const client = (await query('SELECT media_avaliacao, total_avaliacoes FROM clients WHERE telefone = $1', [telefone])).rows[0]
    if (!client) return { media: 0, total: 0 }
    return { media: parseFloat(client.media_avaliacao || 0), total: parseInt(client.total_avaliacoes || 0) }
  })

  fastify.get('/api/config/politica', async (request, reply) => { 
    const configs = (await query('SELECT chave, valor FROM configuracoes')).rows 
    const config = {} 
    configs.forEach(c => config[c.chave] = c.valor) 
    return config 
  })

  fastify.post('/api/rate', async (request, reply) => {
    const { ride_id, tipo, estrelas, comentario, token } = request.body
    if (!ride_id || !tipo || !estrelas || estrelas < 1 || estrelas > 5) {
      return reply.code(400).send({ error: 'Dados incompletos' })
    }
    const ride = (await query('SELECT * FROM rides WHERE id = $1', [ride_id])).rows[0]
    if (!ride) return reply.code(404).send({ error: 'Corrida nÃ£o encontrada' })

    const existing = (await query('SELECT * FROM ratings WHERE ride_id = $1', [ride_id])).rows[0]

    if (tipo === 'motorista') {
      if (existing?.estrelas_motorista) return reply.code(409).send({ error: 'JÃ¡ avaliado' })
      if (existing) {
        await query(`
          UPDATE ratings SET estrelas_motorista = $1, comentario_cliente = $2, avaliado_em_cliente = CURRENT_TIMESTAMP
          WHERE ride_id = $3
        `, [estrelas, comentario || null, ride_id])
      } else {
        await query(`
          INSERT INTO ratings (ride_id, estrelas_motorista, comentario_cliente, avaliado_em_cliente)
          VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        `, [ride_id, estrelas, comentario || null])
      }
      if (ride.driver_id) {
        const stats = (await query(`
          SELECT AVG(estrelas_motorista) as media, COUNT(estrelas_motorista) as total
          FROM ratings WHERE ride_id IN (SELECT id FROM rides WHERE driver_id = $1) AND estrelas_motorista IS NOT NULL
        `, [ride.driver_id])).rows[0]
        await query(`
          UPDATE drivers SET media_avaliacao = $1, total_avaliacoes = $2 WHERE id = $3
        `, [stats.media, stats.total, ride.driver_id])
      }
    } else if (tipo === 'cliente') {
      if (existing?.estrelas_cliente) return reply.code(409).send({ error: 'JÃ¡ avaliado' })
      if (existing) {
        await query(`
          UPDATE ratings SET estrelas_cliente = $1, comentario_motorista = $2, avaliado_em_motorista = CURRENT_TIMESTAMP
          WHERE ride_id = $3
        `, [estrelas, comentario || null, ride_id])
      } else {
        await query(`
          INSERT INTO ratings (ride_id, estrelas_cliente, comentario_motorista, avaliado_em_motorista)
          VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        `, [ride_id, estrelas, comentario || null])
      }
      if (ride.client_id) {
        const stats = (await query(`
          SELECT AVG(estrelas_cliente) as media, COUNT(estrelas_cliente) as total
          FROM ratings WHERE ride_id IN (SELECT id FROM rides WHERE client_id = $1) AND estrelas_cliente IS NOT NULL
        `, [ride.client_id])).rows[0]
        await query(`
          UPDATE clients SET media_avaliacao = $1, total_avaliacoes = $2 WHERE id = $3
        `, [stats.media, stats.total, ride.client_id])
      }
    }
    return { mensagem: 'AvaliaÃ§Ã£o salva!' }
  })

  fastify.post('/api/client/aceitar-termos', async (request, reply) => { 
    try { 
      const { telefone, aceite_responsabilidade } = request.body 
      if (!telefone) return reply.code(400).send({ error: 'Telefone obrigatÃ³rio' }) 
      
      const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip
      const versaoTermos = '2.0'
      
      const clienteResult = await query('SELECT * FROM clients WHERE telefone = $1', [telefone])
      const cliente = clienteResult.rows[0]
      if (!cliente) return reply.code(404).send({ error: 'Cliente nÃ£o encontrado' })

      const termoResult = await query('SELECT * FROM termos_versoes WHERE versao = $1', [versaoTermos])
      const termo = termoResult.rows[0]
      const textoTermo = termo?.conteudo || ''
      
      const dadosHash = `${cliente.nome || ''}|${cliente.cpf || ''}|${telefone}|${ip}|${new Date().toISOString()}|${versaoTermos}|${textoTermo}`
      const hash = crypto.createHash('sha256').update(dadosHash).digest('hex')
      
      await query(` 
        UPDATE clients SET 
          aceitou_termos = true, 
          data_aceite_termos = CURRENT_TIMESTAMP, 
          ip_aceite_termos = $1, 
          versao_termos = '2.0', 
          aceite_responsabilidade = $2,
          hash_aceite_termos = $3
        WHERE telefone = $4 
      `, [ip, aceite_responsabilidade ? true : false, hash, telefone]) 
      
      return { success: true } 
    } catch(err) { 
      console.error('[ACEITE PASSAGEIRO]:', err) 
      return reply.code(500).send({ error: err.message }) 
    } 
  })

  fastify.get('/api/client/termos-status', async (request, reply) => { 
    const { telefone } = request.query 
    if (!telefone) return reply.code(400).send({ error: 'Telefone obrigatÃ³rio' }) 
    const client = (await query( 
      'SELECT aceitou_termos, versao_termos, aceite_responsabilidade FROM clients WHERE telefone = $1', 
      [telefone] 
    )).rows[0] 
    if (!client) return { aceitou_termos: false, versao_termos: null } 
    return client 
  })

  fastify.post('/api/client/cadastrar', async (request, reply) => {
    const { nome, telefone, email, cpf } = request.body
    if (!telefone) return reply.code(400).send({ error: 'Telefone obrigatÃ³rio' })
    
    const result = await query(`
      INSERT INTO clients (telefone, nome, email, cpf)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (telefone) DO UPDATE SET
        nome = COALESCE(EXCLUDED.nome, clients.nome),
        email = COALESCE(EXCLUDED.email, clients.email),
        cpf = COALESCE(EXCLUDED.cpf, clients.cpf)
      RETURNING id
    `, [telefone, nome || null, email || null, cpf || null])
    
    return { success: true, clientId: result.rows[0].id }
  })

  // Endpoints de cartÃ£o
  fastify.post('/api/client/cartao', async (request, reply) => {
    const { telefone, holderName, number, expiryMonth, expiryYear, ccv } = request.body

    if (!telefone || !holderName || !number || !expiryMonth || !expiryYear || !ccv) {
      return reply.code(400).send({ error: 'Dados incompletos' })
    }

    // Buscar cliente por telefone
    const clientResult = await query('SELECT * FROM clients WHERE telefone = $1', [telefone])
    let client = clientResult.rows[0]
    if (!client) {
      return reply.code(404).send({ error: 'Cliente nÃ£o encontrado' })
    }

    // Garantir asaas_customer_id
    let asaasCustomerId = client.asaas_customer_id
    if (!asaasCustomerId && process.env.ASAAS_API_KEY) {
      const customerResponse = await fetch('https://www.asaas.com/api/v3/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access_token': process.env.ASAAS_API_KEY
        },
        body: JSON.stringify({
          name: client.nome,
          phone: client.telefone?.replace(/\D/g, ''),
          mobilePhone: client.telefone?.replace(/\D/g, ''),
          ...(client.cpf ? { cpfCnpj: client.cpf.replace(/\D/g, '') } : {}),
          externalReference: String(client.id)
        })
      })
      const customerData = await customerResponse.json()
      if (customerData.id) {
        asaasCustomerId = customerData.id
        await query('UPDATE clients SET asaas_customer_id = $1 WHERE id = $2', [customerData.id, client.id])
      }
    }

    // Tokenizar cartÃ£o
    if (!process.env.ASAAS_API_KEY) {
      return reply.code(500).send({ error: 'ConfiguraÃ§Ã£o Asaas nÃ£o encontrada' })
    }

    const tokenizeResponse = await fetch('https://www.asaas.com/api/v3/creditCard/tokenize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': process.env.ASAAS_API_KEY
      },
      body: JSON.stringify({
        customer: asaasCustomerId,
        holderName,
        number,
        expiryMonth: String(expiryMonth),
        expiryYear: String(expiryYear),
        ccv
      })
    })

    const tokenizeData = await tokenizeResponse.json()
    console.log('[CARTAO] Resposta Asaas tokenize:', JSON.stringify(tokenizeData))
    if (tokenizeData.creditCardToken) {
      await query(
        'UPDATE clients SET asaas_credit_card_token = $1, asaas_credit_card_brand = $2, asaas_credit_card_last_digits = $3 WHERE id = $4',
        [tokenizeData.creditCardToken, tokenizeData.brand, tokenizeData.number.slice(-4), client.id]
      )
      return {
        tem_cartao: true,
        brand: tokenizeData.brand,
        last_digits: tokenizeData.number.slice(-4),
        creditos: parseFloat(client.creditos || 0)
      }
    } else {
      return reply.code(400).send({ error: 'Erro ao tokenizar cartÃ£o' })
    }
  })

  fastify.delete('/api/client/cartao', async (request, reply) => {
    const { telefone } = request.body
    if (!telefone) {
      return reply.code(400).send({ error: 'Telefone nÃ£o fornecido' })
    }
    await query(
      'UPDATE clients SET asaas_credit_card_token = NULL, asaas_credit_card_brand = NULL, asaas_credit_card_last_digits = NULL WHERE telefone = $1',
      [telefone]
    )
    return { ok: true }
  })

  fastify.get('/api/client/cartao', async (request, reply) => {
    const { telefone } = request.query
    if (!telefone) {
      return reply.code(400).send({ error: 'Telefone nÃ£o fornecido' })
    }
    const clientResult = await query('SELECT * FROM clients WHERE telefone = $1', [telefone])
    const client = clientResult.rows[0]
    if (!client) {
      return { tem_cartao: false, creditos: 0 }
    }
    return {
      tem_cartao: !!client.asaas_credit_card_token,
      brand: client.asaas_credit_card_brand,
      last_digits: client.asaas_credit_card_last_digits,
      creditos: parseFloat(client.creditos || 0)
    }
  })

  // Endpoint de crÃ©ditos
  fastify.post('/api/client/creditos/recarregar', async (request, reply) => {
    return reply.code(503).send({ error: 'Recarga temporariamente indisponÃ­vel. Em breve!' })
  })

  fastify.get('/api/admin/mapa-dados', { preHandler: requireAuth }, async (request, reply) => { 
    const dias = parseInt(request.query.dias || 30) 
    const corridas = (await query(` 
      SELECT id, origem_lat, origem_lng, destino_lat, destino_lng, 
             valor, valor_final, status, h3_id, created_at 
      FROM rides 
      WHERE created_at >= NOW() - INTERVAL '${dias} days' 
      AND status IN ('concluida', 'cancelada', 'aberta', 'aceita') 
      AND (is_teste IS NULL OR is_teste = false) 
      ORDER BY created_at DESC 
      LIMIT 5000 
    `)).rows 
    const stats = (await query(` 
      SELECT 
        COUNT(*) as total, 
        COALESCE(SUM(valor_final), 0) as receita, 
        COUNT(DISTINCT driver_id) as motoristas, 
        COALESCE(AVG(valor_final), 0) as ticket_medio 
      FROM rides 
      WHERE created_at >= NOW() - INTERVAL '${dias} days' 
      AND status = 'concluida' 
      AND (is_teste IS NULL OR is_teste = false) 
    `)).rows[0] 
    return { corridas, stats } 
  })

  // === PAINEL OPERACIONAL ===

  fastify.get('/api/admin/operacional', { preHandler: requireAuth }, async () => {
    const config = (await query('SELECT * FROM operacional_config LIMIT 1')).rows[0]
    const regioes = (await query('SELECT * FROM regioes_cobertura ORDER BY nome')).rows
    const stats = (await query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_teste = true THEN 1 ELSE 0 END) as testes,
        SUM(CASE WHEN is_teste = false OR is_teste IS NULL THEN 1 ELSE 0 END) as reais
      FROM rides
    `)).rows[0]
    return { config, regioes, stats }
  })

  fastify.put('/api/admin/operacional/modo-teste', { preHandler: requireAuth }, async (request, reply) => {
    const { modo_teste } = request.body
    await query('UPDATE operacional_config SET modo_teste = $1, updated_at = NOW() WHERE id = 1', [modo_teste])
    return { success: true, modo_teste }
  })

  fastify.post('/api/admin/operacional/resetar-historico', { preHandler: requireAuth }, async (request, reply) => {
    const { data_corte } = request.body
    const dataCorte = data_corte || new Date().toISOString().split('T')[0]
    const r = await query(`UPDATE rides SET is_teste = true WHERE (is_teste IS NULL OR is_teste = false) AND created_at::date <= $1`, [dataCorte])
    return { success: true, marcadas: r.rowCount }
  })

  fastify.get('/api/admin/operacional/regioes', { preHandler: requireAuth }, async () => {
    const regioes = (await query('SELECT * FROM regioes_cobertura ORDER BY nome')).rows
    return { regioes }
  })

  fastify.post('/api/admin/operacional/regioes', { preHandler: requireAuth }, async (request, reply) => {
    const { nome, lat, lng, raio_km } = request.body
    const r = await query('INSERT INTO regioes_cobertura (nome, lat, lng, raio_km) VALUES ($1, $2, $3, $4) RETURNING *', [nome, lat, lng, raio_km])
    return { success: true, regiao: r.rows[0] }
  })

  fastify.put('/api/admin/operacional/regioes/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { nome, lat, lng, raio_km, ativo } = request.body
    const r = await query('UPDATE regioes_cobertura SET nome=$1, lat=$2, lng=$3, raio_km=$4, ativo=$5 WHERE id=$6 RETURNING *', [nome, lat, lng, raio_km, ativo, request.params.id])
    return { success: true, regiao: r.rows[0] }
  })

  fastify.delete('/api/admin/operacional/regioes/:id', { preHandler: requireAuth }, async (request, reply) => {
    await query('DELETE FROM regioes_cobertura WHERE id = $1', [request.params.id])
    return { success: true }
  })

  fastify.post('/api/motorista/:token/fcm-token', async (request, reply) => {
    const { fcm_token } = request.body
    if (!fcm_token) return reply.code(400).send({ error: 'fcm_token obrigatório' })
    const driver = (await query('SELECT id FROM drivers WHERE token_perfil = $1', [request.params.token])).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' })
    await query('UPDATE drivers SET fcm_token = $1 WHERE id = $2', [fcm_token, driver.id])
    return { success: true }
  })

  fastify.get('/api/tarifa-ativa', async (request, reply) => {
    const agora = new Date()
    const diaSemanaNum = agora.getDay() // 0=dom, 1=seg...
    const horaAtual = `${String(agora.getHours()).padStart(2,'0')}:${String(agora.getMinutes()).padStart(2,'0')}`
    const tarifas = (await query('SELECT * FROM tarifas WHERE ativo = true')).rows
    let tarifaAtiva = null
    for (const t of tarifas) {
      const dias = String(t.dias || '').split(',').map(Number)
      if (!dias.includes(diaSemanaNum)) continue
      const inicio = t.hora_inicio
      const fim = t.hora_fim
      const ativa = inicio <= fim ? (horaAtual >= inicio && horaAtual <= fim) : (horaAtual >= inicio || horaAtual <= fim)
      if (ativa) { tarifaAtiva = t; break }
    }
    if (tarifaAtiva) return { ativa: true, tarifa: tarifaAtiva }
    let proxima = null
    let menorDiff = Infinity
    for (const t of tarifas) {
      const dias = String(t.dias || '').split(',').map(Number)
      for (let d = 0; d <= 6; d++) {
        if (!dias.includes(d)) continue
        const [h, m] = t.hora_inicio.split(':').map(Number)
        const candidata = new Date(agora)
        candidata.setDate(agora.getDate() + ((d - agora.getDay() + 7) % 7))
        candidata.setHours(h, m, 0, 0)
        if (candidata <= agora) candidata.setDate(candidata.getDate() + 7)
        const diff = candidata - agora
        if (diff < menorDiff) { menorDiff = diff; proxima = { tarifa: t, inicio: candidata } }
      }
    }
    return { ativa: false, proxima_hora: proxima?.inicio?.toISOString(), proxima_tarifa: proxima?.tarifa?.nome }
  })

} 

