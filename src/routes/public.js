import { db } from '../db.js' 
import { requireAuth } from '../middleware/auth.js' 
 
export default async function publicRoutes(fastify) { 
 
  fastify.get('/api/ride/:token', async (request, reply) => { 
    const ride = db.prepare(` 
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
      WHERE r.token = ? 
    `).get(request.params.token) 
 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
 
    const rating = db.prepare('SELECT estrelas_motorista, comentario_cliente, avaliado_em_cliente FROM ratings WHERE ride_id = ?').get(ride.id) 
 
    // Remove dados sensíveis antes de retornar 
    delete ride.client_id 
    delete ride.driver_id 
 
    return { ride, rating } 
  }) 
 
  fastify.get('/api/ride/:token/motorista-location', async (request, reply) => { 
    const ride = db.prepare(` 
      SELECT r.*, d.nome as driver_nome, d.modelo_carro, d.cor_carro, d.ano_carro, d.placa 
      FROM rides r 
      LEFT JOIN drivers d ON r.driver_id = d.id 
      WHERE r.token = ? 
    `).get(request.params.token) 
 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    if (!ride.driver_id) return { location: null } 
 
    const location = db.prepare(` 
      SELECT lat, lng, updated_at FROM driver_locations 
      WHERE ride_id = ? 
      ORDER BY updated_at DESC LIMIT 1 
    `).get(ride.id) 
 
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
   
     const ride = db.prepare('SELECT * FROM rides WHERE token = ?').get(request.params.token) 
     if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
     if (ride.status !== 'concluida') return reply.code(400).send({ error: 'Corrida não concluída' }) 
   
     const existing = db.prepare('SELECT * FROM ratings WHERE ride_id = ?').get(ride.id) 
   
     if (existing) { 
       if (existing.estrelas_motorista) { 
         return reply.code(409).send({ error: 'Você já avaliou esta corrida' }) 
       } 
       db.prepare(` 
         UPDATE ratings SET 
           estrelas_motorista = ?, 
           comentario_cliente = ?, 
           avaliado_em_cliente = CURRENT_TIMESTAMP 
         WHERE ride_id = ? 
       `).run(estrelas, comentario || null, ride.id) 
     } else { 
       db.prepare(` 
         INSERT INTO ratings (ride_id, estrelas_motorista, comentario_cliente, avaliado_em_cliente) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP) 
       `).run(ride.id, estrelas, comentario || null) 
     } 
   
     // Recalcula média do motorista 
     if (ride.driver_id) { 
       const stats = db.prepare(` 
         SELECT AVG(estrelas_motorista) as media, COUNT(estrelas_motorista) as total 
         FROM ratings 
         WHERE ride_id IN (SELECT id FROM rides WHERE driver_id = ?) 
         AND estrelas_motorista IS NOT NULL 
       `).get(ride.driver_id) 
   
       db.prepare(` 
         UPDATE drivers SET media_avaliacao = ?, total_avaliacoes = ? WHERE id = ? 
       `).run(stats.media, stats.total, ride.driver_id) 
     } 
   
     return { mensagem: 'Avaliação registrada. Obrigado!' } 
   }) 
   
   // Motorista avalia cliente (chamado pelo bot) 
   fastify.post('/api/internal/rate-client', async (request, reply) => { 
     const { ride_id, driver_telegram_id, estrelas, comentario } = request.body 
   
     const driver = db.prepare('SELECT * FROM drivers WHERE telegram_id = ?').get(String(driver_telegram_id)) 
     if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
   
     const ride = db.prepare('SELECT * FROM rides WHERE id = ? AND driver_id = ?').get(ride_id, driver.id) 
     if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
   
     const existing = db.prepare('SELECT * FROM ratings WHERE ride_id = ?').get(ride_id) 
   
     if (existing) { 
       if (existing.estrelas_cliente) { 
         return reply.code(409).send({ error: 'Motorista já avaliou' }) 
       } 
       db.prepare(` 
         UPDATE ratings SET 
           estrelas_cliente = ?, 
           comentario_motorista = ?, 
           avaliado_em_motorista = CURRENT_TIMESTAMP 
         WHERE ride_id = ? 
       `).run(estrelas, comentario || null, ride_id) 
     } else { 
       db.prepare(` 
         INSERT INTO ratings (ride_id, estrelas_cliente, comentario_motorista, avaliado_em_motorista) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP) 
       `).run(ride_id, estrelas, comentario || null) 
     } 
   
     // Recalcula média do cliente 
     if (ride.client_id) { 
       const stats = db.prepare(` 
         SELECT AVG(estrelas_cliente) as media, COUNT(estrelas_cliente) as total 
         FROM ratings 
         WHERE ride_id IN (SELECT id FROM rides WHERE client_id = ?) 
         AND estrelas_cliente IS NOT NULL 
       `).get(ride.client_id) 
   
       db.prepare(` 
         UPDATE clients SET media_avaliacao = ?, total_avaliacoes = ? WHERE id = ? 
       `).run(stats.media, stats.total, ride.client_id) 
     } 
   
     return { mensagem: 'Avaliação do cliente registrada' } 
   }) 
   
   // Pesquisa de reputação — por corrida 
   fastify.get('/api/reputacao/corrida/:id', { preHandler: requireAuth }, async (request, reply) => { 
     const { id } = request.params 
     const ride = db.prepare(` 
       SELECT r.*, 
         d.nome as driver_nome, d.media_avaliacao as driver_media, d.total_avaliacoes as driver_total, 
         c.nome as client_nome, c.telefone as client_telefone, c.media_avaliacao as client_media 
       FROM rides r 
       LEFT JOIN drivers d ON r.driver_id = d.id 
       LEFT JOIN clients c ON r.client_id = c.id 
       WHERE r.id = ? 
     `).get(id) 
   
     if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
   
     const rating = db.prepare('SELECT * FROM ratings WHERE ride_id = ?').get(id) 
   
     return { ride, rating } 
   }) 
   
   // Pesquisa de reputação — por motorista 
   fastify.get('/api/reputacao/motorista/:id', { preHandler: requireAuth }, async (request, reply) => { 
     const { id } = request.params 
     const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(id) 
     if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
   
     const avaliacoes = db.prepare(` 
       SELECT rt.*, r.origem, r.destino, r.created_at as corrida_data, 
         c.nome as client_nome 
       FROM ratings rt 
       JOIN rides r ON rt.ride_id = r.id 
       LEFT JOIN clients c ON r.client_id = c.id 
       WHERE r.driver_id = ? 
       AND rt.estrelas_motorista IS NOT NULL 
       ORDER BY rt.avaliado_em_cliente DESC 
     `).all(id) 
   
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
     const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id) 
     if (!client) return reply.code(404).send({ error: 'Cliente não encontrado' }) 
   
     const avaliacoes = db.prepare(` 
       SELECT rt.*, r.origem, r.destino, r.created_at as corrida_data, 
         d.nome as driver_nome 
       FROM ratings rt 
       JOIN rides r ON rt.ride_id = r.id 
       LEFT JOIN drivers d ON r.driver_id = d.id 
       WHERE r.client_id = ? 
       AND rt.estrelas_cliente IS NOT NULL 
       ORDER BY rt.avaliado_em_motorista DESC 
     `).all(id) 
   
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
     const mediaMotoristas = db.prepare(` 
       SELECT ROUND(AVG(estrelas_motorista), 2) as media, COUNT(estrelas_motorista) as total 
       FROM ratings WHERE estrelas_motorista IS NOT NULL 
     `).get() 
   
     const mediaClientes = db.prepare(` 
       SELECT ROUND(AVG(estrelas_cliente), 2) as media, COUNT(estrelas_cliente) as total 
       FROM ratings WHERE estrelas_cliente IS NOT NULL 
     `).get() 
   
     const topMotoristas = db.prepare(` 
       SELECT d.id, d.nome, d.media_avaliacao, d.total_avaliacoes, d.total_viagens 
       FROM drivers d 
       WHERE d.total_avaliacoes > 0 
       ORDER BY d.media_avaliacao DESC, d.total_avaliacoes DESC 
       LIMIT 10 
     `).all() 
   
     const clientesProblematicos = db.prepare(` 
       SELECT c.id, c.nome, c.telefone, c.media_avaliacao, c.total_avaliacoes 
       FROM clients c 
       WHERE c.media_avaliacao < 3 AND c.total_avaliacoes >= 2 
       ORDER BY c.media_avaliacao ASC 
     `).all() 
   
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
 
    let client = db.prepare('SELECT * FROM clients WHERE telefone = ?').get(celular) 
    if (!client) { 
      const r = db.prepare(` 
        INSERT INTO clients (telefone, nome, email) VALUES (?, ?, ?) 
      `).run(celular, nome || null, email || null) 
      client = { id: r.lastInsertRowid } 
    } else { 
      db.prepare(` 
        UPDATE clients SET 
          nome = COALESCE(?, nome), 
          email = COALESCE(?, email) 
        WHERE id = ? 
      `).run(nome || null, email || null, client.id) 
    } 
 
    const { v4: uuidv4 } = await import('uuid') 
    const token = uuidv4() 
    const statusInicial = tipo === 'agendada' ? 'agendada' : 'aberta' 
    const valorMotorista = parseFloat((valor * 0.70).toFixed(2)) 
    const valorMobihub = parseFloat((valor * 0.30).toFixed(2)) 
 
    const result = db.prepare(` 
      INSERT INTO rides 
        (token, client_id, origem, origem_lat, origem_lng, 
         destino, destino_lat, destino_lng, valor, 
         valor_motorista, valor_mobihub, tipo, agendada_para, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
    `).run( 
      token, client.id, origem, origem_lat, origem_lng, 
      destino, destino_lat, destino_lng, valor, 
      valorMotorista, valorMobihub, 
      tipo || 'normal', agendada_para || null, statusInicial 
    ) 
 
    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(result.lastInsertRowid) 
 
    // Só dispara imediatamente se for corrida NORMAL 
    if (!tipo || tipo === 'normal') { 
      try { 
        const { sendRideToGroup } = await import('../telegram.js') 
        const messageId = await sendRideToGroup(ride) 
        db.prepare('UPDATE rides SET telegram_message_id = ? WHERE id = ?').run(messageId, ride.id) 
      } catch(err) { 
        console.error('[SOLICITAR] Erro ao enviar para Telegram:', err.message) 
      } 
    } 
 
    const link = `${process.env.BASE_URL}/r/${token}` 
    return { token, link, mensagem: 'Corrida solicitada com sucesso!' } 
  }) 
 
  // Perfil público do motorista 
  fastify.get('/api/motorista/:token', async (request, reply) => { 
    const driver = db.prepare(` 
      SELECT id, nome, modelo_carro, ano_carro, cor_carro, placa, 
        total_viagens, media_avaliacao, total_avaliacoes, 
        foto_base64, ativo, created_at 
      FROM drivers WHERE token_perfil = ? 
    `).get(request.params.token) 
 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    // Histórico de corridas do motorista 
    const corridas = db.prepare(` 
      SELECT r.id, r.origem, r.destino, r.valor, r.valor_motorista, 
        r.status, r.created_at, r.concluida_at, r.tipo, 
        r.agendada_para 
      FROM rides r 
      WHERE r.driver_id = ? 
      ORDER BY r.created_at DESC 
      LIMIT 30 
    `).all(driver.id) 
 
    // Comentários recebidos SEM identificar o passageiro 
    const comentarios = db.prepare(` 
      SELECT rt.estrelas_motorista, rt.comentario_cliente, rt.avaliado_em_cliente 
      FROM ratings rt 
      JOIN rides r ON rt.ride_id = r.id 
      WHERE r.driver_id = ? AND rt.estrelas_motorista IS NOT NULL 
      ORDER BY rt.avaliado_em_cliente DESC 
      LIMIT 20 
    `).all(driver.id) 
 
    // Estatísticas financeiras 
    const financeiro = db.prepare(` 
      SELECT 
        COUNT(*) as total_corridas, 
        SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) as concluidas, 
        ROUND(SUM(CASE WHEN status = 'concluida' THEN COALESCE(valor_motorista, valor * 0.70) ELSE 0 END), 2) as ganhos_total, 
        ROUND(SUM(CASE WHEN status = 'concluida' AND DATE(concluida_at) = DATE('now', 'localtime') THEN COALESCE(valor_motorista, valor * 0.70) ELSE 0 END), 2) as ganhos_hoje, 
        ROUND(SUM(CASE WHEN status = 'concluida' AND DATE(concluida_at) >= DATE('now', '-7 days', 'localtime') THEN COALESCE(valor_motorista, valor * 0.70) ELSE 0 END), 2) as ganhos_semana, 
        ROUND(SUM(CASE WHEN status = 'concluida' AND strftime('%Y-%m', concluida_at) = strftime('%Y-%m', 'now', 'localtime') THEN COALESCE(valor_motorista, valor * 0.70) ELSE 0 END), 2) as ganhos_mes 
      FROM rides WHERE driver_id = ? 
    `).get(driver.id) 
 
    return { driver, corridas, comentarios, financeiro } 
  }) 
 
  // Atualizar foto do motorista 
  fastify.put('/api/motorista/:token/foto', async (request, reply) => { 
    const { foto_base64 } = request.body 
 
    if (!foto_base64) return reply.code(400).send({ error: 'Foto é obrigatória' }) 
 
    const driver = db.prepare('SELECT id FROM drivers WHERE token_perfil = ?').get(request.params.token) 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    db.prepare('UPDATE drivers SET foto_base64 = ? WHERE id = ?').run(foto_base64, driver.id) 
 
    return { mensagem: 'Foto atualizada com sucesso!' } 
  }) 
}
