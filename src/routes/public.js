import { query, pool } from '../db.js' 
import { requireAuth } from '../middleware/auth.js' 
 
export default async function publicRoutes(fastify) { 
 
  fastify.get('/api/ride/:token', async (request, reply) => { 
    const { token } = request.params 
    console.log('[DEBUG] Buscando corrida pelo token:', token) 
    
    const ride = (await query(` 
      SELECT r.*, 
        d.nome as driver_nome, 
        d.modelo_carro, d.ano_carro, d.cor_carro, d.placa, 
        d.foto_base64 as driver_foto, 
        d.media_avaliacao as driver_media, 
        d.total_viagens as driver_viagens, 
        c.nome as client_nome 
      FROM rides r 
      LEFT JOIN drivers d ON r.driver_id = d.id 
      LEFT JOIN clients c ON r.client_id = c.id 
      WHERE r.token = $1 
    `, [token])).rows[0] 
  
    console.log('[DEBUG] Status da corrida:', ride?.status, '| Driver:', ride?.driver_nome) 
  
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
  
    const rating = (await query( 
      'SELECT estrelas_motorista, comentario_cliente, avaliado_em_cliente FROM ratings WHERE ride_id = $1', 
      [ride.id] 
    )).rows[0] 
  
    const paradas = (await query( 
      'SELECT duracao_min, custo, iniciada_at, finalizada_at FROM ride_stops WHERE ride_id = $1 ORDER BY iniciada_at', 
      [ride.id] 
    )).rows 
  
    const configs = (await query('SELECT chave, valor FROM configuracoes')).rows 
    const config = {} 
    configs.forEach(c => config[c.chave] = c.valor) 
  
    delete ride.client_id 
    delete ride.driver_id 
  
    return { ride, rating, paradas, config } 
  }) 
 
  fastify.get('/api/ride/:token/motorista-location', async (request, reply) => { 
    const result = await query(` 
      SELECT r.*, d.nome as driver_nome, d.modelo_carro, d.cor_carro, d.ano_carro, d.placa 
      FROM rides r 
      LEFT JOIN drivers d ON r.driver_id = d.id 
      WHERE r.token = $1 
    `, [request.params.token]) 
    const ride = result.rows[0] 
 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    if (!ride.driver_id) return { location: null } 
 
    const locationResult = await query(` 
      SELECT lat, lng, updated_at FROM driver_locations 
      WHERE ride_id = $1 
      ORDER BY updated_at DESC LIMIT 1 
    `, [ride.id]) 
    const location = locationResult.rows[0] 
 
    if (!location) return { location: null, mensagem: 'Aguardando localização do motorista' } 
 
    // Calcula tempo desde última atualização 
    const segundos = Math.floor((Date.now() - new Date(location.updated_at).getTime()) / 1000) 
 
    return { 
      location: { 
        lat: location.lat, 
        lng: location.lng, 
        updated_at: location.updated_at, 
        segundos_atras: segundos, 
        ativo: segundos < 60 
      } 
    } 
  }) 
 
  // Cliente avalia motorista 
   fastify.post('/api/ride/:token/avaliar-motorista', async (request, reply) => { 
     const { estrelas, comentario } = request.body 
   
     if (!estrelas || estrelas < 1 || estrelas > 5) { 
       return reply.code(400).send({ error: 'Estrelas deve ser entre 1 e 5' }) 
     } 
   
     const rideResult = await query('SELECT * FROM rides WHERE token = $1', [request.params.token]) 
     const ride = rideResult.rows[0] 
     if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
     if (ride.status !== 'concluida') return reply.code(400).send({ error: 'Corrida não concluída' }) 
   
     const existingResult = await query('SELECT * FROM ratings WHERE ride_id = $1', [ride.id]) 
     const existing = existingResult.rows[0] 
   
     if (existing) { 
       if (existing.estrelas_motorista) { 
         return reply.code(409).send({ error: 'Você já avaliou esta corrida' }) 
       } 
       await query(` 
         UPDATE ratings SET 
           estrelas_motorista = $1, 
           comentario_cliente = $2, 
           avaliado_em_cliente = CURRENT_TIMESTAMP 
         WHERE ride_id = $3 
       `, [estrelas, comentario || null, ride.id]) 
     } else { 
       await query(` 
         INSERT INTO ratings (ride_id, estrelas_motorista, comentario_cliente, avaliado_em_cliente) 
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP) 
       `, [ride.id, estrelas, comentario || null]) 
     } 
   
     // Recalcula média do motorista 
     if (ride.driver_id) { 
       const statsResult = await query(` 
         SELECT AVG(estrelas_motorista) as media, COUNT(estrelas_motorista) as total 
         FROM ratings 
         WHERE ride_id IN (SELECT id FROM rides WHERE driver_id = $1) 
         AND estrelas_motorista IS NOT NULL 
       `, [ride.driver_id]) 
       const stats = statsResult.rows[0] 
   
       await query(` 
         UPDATE drivers SET media_avaliacao = $1, total_avaliacoes = $2 WHERE id = $3 
       `, [stats.media, stats.total, ride.driver_id]) 
     } 
   
     return { mensagem: 'Avaliação registrada. Obrigado!' } 
   }) 
   
   // Motorista avalia cliente (chamado pelo bot) 
   fastify.post('/api/internal/rate-client', async (request, reply) => { 
     const { ride_id, driver_telegram_id, estrelas, comentario } = request.body 
   
     const driverResult = await query('SELECT * FROM drivers WHERE telegram_id = $1', [String(driver_telegram_id)]) 
     const driver = driverResult.rows[0] 
     if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
   
     const rideResult = await query('SELECT * FROM rides WHERE id = $1 AND driver_id = $2', [ride_id, driver.id]) 
     const ride = rideResult.rows[0] 
     if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
   
     const existingResult = await query('SELECT * FROM ratings WHERE ride_id = $1', [ride_id]) 
     const existing = existingResult.rows[0] 
   
     if (existing) { 
       if (existing.estrelas_cliente) { 
         return reply.code(409).send({ error: 'Motorista já avaliou' }) 
       } 
       await query(` 
         UPDATE ratings SET 
           estrelas_cliente = $1, 
           comentario_motorista = $2, 
           avaliado_em_motorista = CURRENT_TIMESTAMP 
         WHERE ride_id = $3 
       `, [estrelas, comentario || null, ride_id]) 
     } else { 
       await query(` 
         INSERT INTO ratings (ride_id, estrelas_cliente, comentario_motorista, avaliado_em_motorista) 
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP) 
       `, [ride_id, estrelas, comentario || null]) 
     } 
   
     // Recalcula média do cliente 
     if (ride.client_id) { 
       const statsResult = await query(` 
         SELECT AVG(estrelas_cliente) as media, COUNT(estrelas_cliente) as total 
         FROM ratings 
         WHERE ride_id IN (SELECT id FROM rides WHERE client_id = $1) 
         AND estrelas_cliente IS NOT NULL 
       `, [ride.client_id]) 
       const stats = statsResult.rows[0] 
   
       await query(` 
         UPDATE clients SET media_avaliacao = $1, total_avaliacoes = $2 WHERE id = $3 
       `, [stats.media, stats.total, ride.client_id]) 
     } 
   
     return { mensagem: 'Avaliação do cliente registrada' } 
   }) 
   
   // Pesquisa de reputação — por corrida 
   fastify.get('/api/reputacao/corrida/:id', { preHandler: requireAuth }, async (request, reply) => { 
     const { id } = request.params 
     const result = await query(` 
       SELECT r.*, 
         d.nome as driver_nome, d.media_avaliacao as driver_media, d.total_avaliacoes as driver_total, 
         c.nome as client_nome, c.telefone as client_telefone, c.media_avaliacao as client_media 
       FROM rides r 
       LEFT JOIN drivers d ON r.driver_id = d.id 
       LEFT JOIN clients c ON r.client_id = c.id 
       WHERE r.id = $1 
     `, [id]) 
     const ride = result.rows[0] 
   
     if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
   
     const ratingResult = await query('SELECT * FROM ratings WHERE ride_id = $1', [id]) 
     const rating = ratingResult.rows[0] 
   
     return { ride, rating } 
   }) 
   
   // Pesquisa de reputação — por motorista 
   fastify.get('/api/reputacao/motorista/:id', { preHandler: requireAuth }, async (request, reply) => { 
     const { id } = request.params 
     const driverResult = await query('SELECT * FROM drivers WHERE id = $1', [id]) 
     const driver = driverResult.rows[0] 
     if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
   
     const result = await query(` 
       SELECT rt.*, r.origem, r.destino, r.created_at as corrida_data, 
         c.nome as client_nome 
       FROM ratings rt 
       JOIN rides r ON rt.ride_id = r.id 
       LEFT JOIN clients c ON r.client_id = c.id 
       WHERE r.driver_id = $1 
       AND rt.estrelas_motorista IS NOT NULL 
       ORDER BY rt.avaliado_em_cliente DESC 
     `, [id]) 
     const avaliacoes = result.rows 
   
     return { 
       driver: { 
         id: driver.id, 
         nome: driver.nome, 
         media_avaliacao: driver.media_avaliacao, 
         total_avaliacoes: driver.total_avaliacoes, 
         total_viagens: driver.total_viagens 
       }, 
       avaliacoes 
     } 
   }) 
   
   // Pesquisa de reputação — por cliente 
   fastify.get('/api/reputacao/cliente/:id', { preHandler: requireAuth }, async (request, reply) => { 
     const { id } = request.params 
     const clientResult = await query('SELECT * FROM clients WHERE id = $1', [id]) 
     const client = clientResult.rows[0] 
     if (!client) return reply.code(404).send({ error: 'Cliente não encontrado' }) 
   
     const result = await query(` 
       SELECT rt.*, r.origem, r.destino, r.created_at as corrida_data, 
         d.nome as driver_nome 
       FROM ratings rt 
       JOIN rides r ON rt.ride_id = r.id 
       LEFT JOIN drivers d ON r.driver_id = d.id 
       WHERE r.client_id = $1 
       AND rt.estrelas_cliente IS NOT NULL 
       ORDER BY rt.avaliado_em_motorista DESC 
     `, [id]) 
     const avaliacoes = result.rows 
   
     return { 
       client: { 
         id: client.id, 
         nome: client.nome, 
         telefone: client.telefone, 
         media_avaliacao: client.media_avaliacao, 
         total_avaliacoes: client.total_avaliacoes, 
         total_corridas: client.total_corridas 
       }, 
       avaliacoes 
     } 
   }) 
   
   // Média geral do sistema 
   fastify.get('/api/reputacao/geral', { preHandler: requireAuth }, async () => { 
     const mediaMotoristasResult = await query(` 
       SELECT ROUND(AVG(estrelas_motorista), 2) as media, COUNT(estrelas_motorista) as total 
       FROM ratings WHERE estrelas_motorista IS NOT NULL 
     `) 
     const mediaMotoristas = mediaMotoristasResult.rows[0] 
   
     const mediaClientesResult = await query(` 
       SELECT ROUND(AVG(estrelas_cliente), 2) as media, COUNT(estrelas_cliente) as total 
       FROM ratings WHERE estrelas_cliente IS NOT NULL 
     `) 
     const mediaClientes = mediaClientesResult.rows[0] 
   
     const topMotoristasResult = await query(` 
       SELECT d.id, d.nome, d.media_avaliacao, d.total_avaliacoes, d.total_viagens 
       FROM drivers d 
       WHERE d.total_avaliacoes > 0 
       ORDER BY d.media_avaliacao DESC, d.total_avaliacoes DESC 
       LIMIT 10 
     `) 
     const topMotoristas = topMotoristasResult.rows 
   
     const clientesProblematicosResult = await query(` 
       SELECT c.id, c.nome, c.telefone, c.media_avaliacao, c.total_avaliacoes 
       FROM clients c 
       WHERE c.media_avaliacao < 3 AND c.total_avaliacoes >= 2 
       ORDER BY c.media_avaliacao ASC 
     `) 
     const clientesProblematicos = clientesProblematicosResult.rows 
   
     return { mediaMotoristas, mediaClientes, topMotoristas, clientesProblematicos } 
   }) 
 
  fastify.post('/api/solicitar', async (request, reply) => { 
    const { 
      nome, celular, email, 
      origem, origem_lat, origem_lng, 
      destino, destino_lat, destino_lng, 
      valor, tipo, agendada_para 
    } = request.body 
 
    if (!origem || !destino || !valor || !celular) { 
      return reply.code(400).send({ error: 'Dados incompletos' }) 
    } 
 
    const clientResult = await query('SELECT * FROM clients WHERE telefone = $1', [celular]) 
    let client = clientResult.rows[0] 
    if (!client) { 
      const r = await query(` 
        INSERT INTO clients (telefone, nome, email) VALUES ($1, $2, $3) RETURNING id 
      `, [celular, nome || null, email || null]) 
      client = { id: r.rows[0].id } 
    } else { 
      await query(` 
        UPDATE clients SET 
          nome = COALESCE($1, nome), 
          email = COALESCE($2, email) 
        WHERE id = $3 
      `, [nome || null, email || null, client.id]) 
    } 
 
    const { v4: uuidv4 } = await import('uuid') 
    const token = uuidv4() 
    const statusInicial = tipo === 'agendada' ? 'agendada' : 'aberta' 
    const valorMotorista = parseFloat((valor * 0.70).toFixed(2)) 
    const valorMobihub = parseFloat((valor * 0.30).toFixed(2)) 
 
    const result = await query(` 
      INSERT INTO rides 
        (token, client_id, origem, origem_lat, origem_lng, 
         destino, destino_lat, destino_lng, valor, 
         valor_motorista, valor_mobihub, tipo, agendada_para, status) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id 
    `, [ 
      token, client.id, origem, origem_lat, origem_lng, 
      destino, destino_lat, destino_lng, valor, 
      valorMotorista, valorMobihub, 
      tipo || 'normal', agendada_para || null, statusInicial 
    ]) 
 
    const rideResult = await query('SELECT * FROM rides WHERE id = $1', [result.rows[0].id]) 
    const ride = rideResult.rows[0] 
 
    // Só dispara imediatamente se for corrida NORMAL 
    if (!tipo || tipo === 'normal') { 
      try { 
        const { sendRideToGroup } = await import('../telegram.js') 
        const messageId = await sendRideToGroup(ride) 
        if (messageId) { 
          await query('UPDATE rides SET telegram_message_id = $1 WHERE id = $2', [messageId, ride.id]) 
        } 
      } catch(err) { 
        console.error('[SOLICITAR] Erro ao enviar para Telegram:', err.message) 
      } 
    } 
 
    const link = `${process.env.BASE_URL}/r/${token}` 
    return { token, link, mensagem: 'Corrida solicitada com sucesso!' } 
  }) 
 
  // Perfil público do motorista 
  fastify.get('/api/motorista/:token', async (request, reply) => { 
    const result = await query(` 
      SELECT id, nome, modelo_carro, ano_carro, cor_carro, placa, 
        total_viagens, media_avaliacao, total_avaliacoes, 
        foto_base64, ativo, created_at 
      FROM drivers WHERE token_perfil = $1 
    `, [request.params.token]) 
    const driver = result.rows[0] 
 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    // Histórico de corridas do motorista 
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
 
    // Comentários recebidos SEM identificar o passageiro 
    const comentariosResult = await query(` 
      SELECT rt.estrelas_motorista, rt.comentario_cliente, rt.avaliado_em_cliente 
      FROM ratings rt 
      JOIN rides r ON rt.ride_id = r.id 
      WHERE r.driver_id = $1 AND rt.estrelas_motorista IS NOT NULL 
      ORDER BY rt.avaliado_em_cliente DESC 
      LIMIT 20 
    `, [driver.id]) 
    const comentarios = comentariosResult.rows 
 
    // Estatísticas financeiras 
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
 
  // Atualizar foto do motorista 
  fastify.put('/api/motorista/:token/foto', async (request, reply) => { 
    const { foto_base64 } = request.body 
 
    if (!foto_base64) return reply.code(400).send({ error: 'Foto é obrigatória' }) 
 
    const driverResult = await query('SELECT id FROM drivers WHERE token_perfil = $1', [request.params.token]) 
    const driver = driverResult.rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    await query('UPDATE drivers SET foto_base64 = $1 WHERE id = $2', [foto_base64, driver.id]) 
 
    return { mensagem: 'Foto atualizada com sucesso!' } 
  }) 
 
  // Motoristas online com localização 
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
        WHERE r.driver_id = d.id AND r.status = 'aceita' 
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
 
  // Verificar validade do convite 
  fastify.get('/api/convite/:token', async (request, reply) => { 
    const result = await query( 
      'SELECT * FROM convites WHERE token = $1 AND usado = false AND expira_em > NOW()', 
      [request.params.token] 
    ) 
    if (!result.rows.length) { 
      return reply.code(404).send({ error: 'Convite inválido ou expirado' }) 
    } 
    return { valido: true } 
  }) 
 
  // Cadastro público do motorista via convite 
  fastify.post('/api/cadastro-motorista/:token', async (request, reply) => { 
    const { token } = request.params 
    const { nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, foto_base64 } = request.body 
 
    // Verifica convite 
    const convite = (await query( 
      'SELECT * FROM convites WHERE token = $1 AND usado = false AND expira_em > NOW()', 
      [token] 
    )).rows[0] 
 
    if (!convite) return reply.code(400).send({ error: 'Convite inválido ou expirado' }) 
 
    // Verifica se Telegram ID já existe 
    const existing = (await query( 
      'SELECT id FROM drivers WHERE telegram_id = $1', 
      [telegram_id] 
    )).rows[0] 
 
    if (existing) return reply.code(409).send({ error: 'Este Telegram ID já está cadastrado' }) 
 
    // Gera token de perfil 
    const { v4: uuidv4 } = await import('uuid') 
    const tokenPerfil = uuidv4() 
 
    // Cadastra motorista como pendente 
    const result = await query(` 
      INSERT INTO drivers 
        (nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, 
         foto_base64, token_perfil, status_cadastro, ativo) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendente', 0) 
      RETURNING id 
    `, [nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, foto_base64 || null, tokenPerfil]) 
 
    const driverId = result.rows[0].id 
 
    // Marca convite como usado 
    await query( 
      'UPDATE convites SET usado = true, usado_em = NOW(), driver_id = $1 WHERE token = $2', 
      [driverId, token] 
    ) 
 
    // Notifica admin no Telegram 
    try { 
      const { getBot } = await import('../telegram.js') 
      const bot = getBot() 
      const linkAdmin = `${process.env.BASE_URL}/admin/motoristas` 
      bot?.sendMessage(process.env.TELEGRAM_GROUP_ID, 
        `🆕 *Novo motorista aguardando aprovação!*\n\n👤 ${nome}\n🚗 ${modelo_carro} ${cor_carro} ${ano_carro}\n📋 Placa: ${placa}\n📱 Tel: ${telefone}\n\n✅ Acesse o painel para aprovar:\n${linkAdmin}`, 
        { parse_mode: 'Markdown' } 
      ).catch(() => {}) 
    } catch(e) {} 
 
    return { mensagem: 'Cadastro enviado com sucesso! Aguarde aprovação.' } 
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
      "SELECT * FROM rides WHERE driver_id = $1 AND status = 'aceita' ORDER BY aceita_at DESC LIMIT 1", 
      [driver.id] 
    )).rows[0] 
 
    return { corrida: corrida || null } 
  }) 
 
  fastify.put('/api/rides/:id/aceitar-motorista', async (request, reply) => { 
    const { token_motorista } = request.body 
    const { id } = request.params 
 
    const driver = (await query( 
      "SELECT * FROM drivers WHERE token_perfil = $1 AND ativo = 1 AND status_cadastro = 'aprovado'", 
      [token_motorista] 
    )).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    const ride = (await query( 
      "SELECT * FROM rides WHERE id = $1 AND status = 'aberta'", 
      [id] 
    )).rows[0] 
    if (!ride) return reply.code(400).send({ error: 'Corrida não disponível' }) 
 
    await query( 
      "UPDATE rides SET status = 'aceita', driver_id = $1, aceita_at = CURRENT_TIMESTAMP WHERE id = $2", 
      [driver.id, id] 
    ) 
 
    if (ride.telegram_message_id) { 
      try { 
        const { editGroupMessage } = await import('../telegram.js') 
        await editGroupMessage(ride.telegram_message_id, 
          `✅ *Corrida aceita!*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}\n\n🧑‍✈️ *${driver.nome}*\n🚗 ${driver.modelo_carro} ${driver.cor_carro} — ${driver.placa}` 
        ) 
      } catch(e) {} 
    } 
 
    return { mensagem: 'Corrida aceita!', token: ride.token } 
  }) 
 
  fastify.put('/api/rides/:id/finalizar-motorista', async (request, reply) => { 
    const { token_motorista } = request.body 
    const { id } = request.params 
 
    const driver = (await query( 
      'SELECT * FROM drivers WHERE token_perfil = $1', 
      [token_motorista] 
    )).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    const ride = (await query( 
      "SELECT * FROM rides WHERE id = $1 AND driver_id = $2 AND status = 'aceita'", 
      [id, driver.id] 
    )).rows[0] 
    if (!ride) return reply.code(400).send({ error: 'Corrida não encontrada' }) 
 
    const { calculateTotalRideCost } = await import('../billing.js') 
    const configs = (await query('SELECT chave, valor FROM configuracoes')).rows 
    const config = {} 
    configs.forEach(c => config[c.chave] = c.valor) 
 
    const valorFinal = calculateTotalRideCost( 
      ride.valor || 0, 
      ride.custo_espera_inicial || 0, 
      ride.custo_paradas || 0, 
      config 
    ) 
    const valorMotorista = parseFloat((valorFinal * 0.70).toFixed(2)) 
 
    await query( 
      "UPDATE rides SET status = 'concluida', concluida_at = CURRENT_TIMESTAMP, valor_final = $1, valor_motorista = $2, valor_mobihub = $3 WHERE id = $4", 
      [valorFinal, valorMotorista, parseFloat((valorFinal - valorMotorista).toFixed(2)), id] 
    ) 
 
    await query('UPDATE drivers SET total_viagens = total_viagens + 1 WHERE id = $1', [driver.id]) 
    if (ride.client_id) { 
      await query('UPDATE clients SET total_corridas = total_corridas + 1 WHERE id = $1', [ride.client_id]) 
    } 
 
    try { 
      const { notifyDriverRateClient, editGroupMessage } = await import('../telegram.js') 
      await notifyDriverRateClient(driver, ride) 
      if (ride.telegram_message_id) { 
        await editGroupMessage(ride.telegram_message_id, 
          `✅ *Corrida concluída!*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}\n💰 R$ ${valorFinal.toFixed(2)}` 
        ) 
      } 
    } catch(e) {} 
 
    return { 
      mensagem: 'Corrida finalizada!', 
      valor_final: valorFinal, 
      valor_motorista: valorMotorista 
    } 
  }) 
 
  fastify.put('/api/rides/:id/parada/ultima/finalizar', async (request, reply) => { 
    const { id } = request.params 
 
    const stop = (await query( 
      'SELECT * FROM ride_stops WHERE ride_id = $1 AND finalizada_at IS NULL ORDER BY iniciada_at DESC LIMIT 1', 
      [id] 
    )).rows[0] 
    if (!stop) return reply.code(404).send({ error: 'Nenhuma parada em andamento' }) 
 
    const { calculateStopCost, calcularTempoMinutos } = await import('../billing.js') 
    const configs = (await query('SELECT chave, valor FROM configuracoes')).rows 
    const config = {} 
    configs.forEach(c => config[c.chave] = c.valor) 
 
    const duracao = calcularTempoMinutos(stop.iniciada_at) 
    const custo = calculateStopCost(duracao, config) 
 
    await query( 
      'UPDATE ride_stops SET finalizada_at = CURRENT_TIMESTAMP, duracao_min = $1, custo = $2 WHERE id = $3', 
      [duracao, custo, stop.id] 
    ) 
 
    const totalParadas = (await query( 
      'SELECT COALESCE(SUM(custo),0) as total, COALESCE(SUM(duracao_min),0) as tempo FROM ride_stops WHERE ride_id = $1', 
      [id] 
    )).rows[0] 
 
    await query( 
      "UPDATE rides SET status_detalhe = 'em_andamento', custo_paradas = $1, tempo_paradas_total_min = $2 WHERE id = $3", 
      [totalParadas.total, totalParadas.tempo, id] 
    ) 
 
    return { mensagem: 'Parada finalizada!', custo_parada: custo } 
  }) 
 
  // Buscar mensagens da corrida (passageiro) 
  fastify.get('/api/ride/:token/mensagens', async (request, reply) => { 
    const ride = (await query('SELECT id FROM rides WHERE token = $1', [request.params.token])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    const mensagens = (await query( 
      'SELECT id, remetente, mensagem, created_at FROM ride_messages WHERE ride_id = $1 ORDER BY created_at ASC', 
      [ride.id] 
    )).rows 
    await query("UPDATE ride_messages SET lida = 1 WHERE ride_id = $1 AND remetente = 'motorista' AND lida = 0", [ride.id]) 
    return { mensagens } 
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
    const ride = (await query("SELECT id FROM rides WHERE id = $1 AND driver_id = $2 AND status = 'aceita'", [rideId, driver.id])).rows[0] 
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
      'SELECT id, remetente, mensagem, created_at FROM ride_messages WHERE ride_id = $1 ORDER BY created_at ASC', 
      [rideId] 
    )).rows 
    await query("UPDATE ride_messages SET lida = 1 WHERE ride_id = $1 AND remetente = 'passageiro' AND lida = 0", [rideId]) 
    return { mensagens } 
  }) 
 
  // ETA e localização do motorista 
  fastify.get('/api/ride/:token/motorista-location', async (request, reply) => { 
    const ride = (await query('SELECT * FROM rides WHERE token = $1', [request.params.token])).rows[0] 
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
} 
