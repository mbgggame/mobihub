import { db } from '../db.js' 
 
export default async function publicRoutes(fastify) { 
 
  fastify.get('/api/ride/:token', async (request, reply) => { 
    const ride = db.prepare(` 
      SELECT r.*, 
        d.nome as driver_nome, d.modelo_carro, d.ano_carro, d.cor_carro, 
        d.placa, d.telefone as driver_telefone, 
        d.media_avaliacao as driver_media, d.total_viagens as driver_viagens, 
        c.nome as client_nome, c.telefone as client_telefone 
      FROM rides r 
      LEFT JOIN drivers d ON r.driver_id = d.id 
      LEFT JOIN clients c ON r.client_id = c.id 
      WHERE r.token = ? 
    `).get(request.params.token) 
 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
 
    const rating = db.prepare('SELECT * FROM ratings WHERE ride_id = ?').get(ride.id) 
 
    return { ride, rating } 
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
 
  // Motorista avalia cliente (chamado internamente pelo bot) 
  fastify.post('/api/internal/rate-client', async (request, reply) => { 
    const { ride_id, driver_telegram_id, estrelas, comentario } = request.body 
 
    const driver = db.prepare('SELECT * FROM drivers WHERE telegram_id = ?').get(String(driver_telegram_id)) 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    const ride = db.prepare('SELECT * FROM rides WHERE id = ? AND driver_id = ?').get(ride_id, driver.id) 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
 
    const existing = db.prepare('SELECT * FROM ratings WHERE ride_id = ?').get(ride_id) 
 
    if (existing) { 
      if (existing.estrelas_cliente) { 
        return reply.code(409).send({ error: 'Motorista já avaliou este cliente' }) 
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
 }
