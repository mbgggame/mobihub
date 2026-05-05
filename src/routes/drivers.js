import { db } from '../db.js' 
import { requireAuth } from '../middleware/auth.js' 
 
export default async function driversRoutes(fastify) { 
 
  fastify.get('/api/drivers', { preHandler: requireAuth }, async () => { 
    return db.prepare('SELECT * FROM drivers ORDER BY nome').all() 
  }) 
 
  fastify.post('/api/drivers', { preHandler: requireAuth }, async (request, reply) => { 
    const { 
      nome, telefone, telegram_id, 
      modelo_carro, ano_carro, cor_carro, placa, foto_base64 
    } = request.body 
 
    if (!nome || !telegram_id || !modelo_carro || !ano_carro || !cor_carro || !placa) { 
      return reply.code(400).send({ error: 'Todos os campos são obrigatórios' }) 
    } 
 
    try { 
      const result = db.prepare(` 
        INSERT INTO drivers 
          (nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, foto_base64) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
      `).run(nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, foto_base64 || null) 
 
      return { id: result.lastInsertRowid, mensagem: 'Motorista cadastrado com sucesso' } 
    } catch (err) { 
      if (err.message.includes('UNIQUE')) { 
        return reply.code(409).send({ error: 'Telegram ID já cadastrado' }) 
      } 
      throw err 
    } 
  }) 
 
  fastify.put('/api/drivers/:id', { preHandler: requireAuth }, async (request, reply) => { 
    console.log('[DEBUG] PUT /api/drivers/:id chamado, id:', request.params.id) 
    console.log('[DEBUG] Body recebido:', request.body) 
    const { nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, ativo, foto_base64 } = request.body 
    const { id } = request.params 
 
    const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(id) 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    db.prepare(` 
      UPDATE drivers SET 
        nome = COALESCE(?, nome), 
        telefone = COALESCE(?, telefone), 
        telegram_id = COALESCE(?, telegram_id),
        modelo_carro = COALESCE(?, modelo_carro), 
        ano_carro = COALESCE(?, ano_carro), 
        cor_carro = COALESCE(?, cor_carro), 
        placa = COALESCE(?, placa), 
        ativo = COALESCE(?, ativo), 
        foto_base64 = COALESCE(?, foto_base64) 
      WHERE id = ? 
    `).run(nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, ativo, foto_base64, id) 
 
    return { mensagem: 'Motorista atualizado' } 
  }) 
 
  fastify.delete('/api/drivers/:id', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(id) 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    db.prepare('UPDATE drivers SET ativo = 0 WHERE id = ?').run(id) 
    return { mensagem: 'Motorista desativado' } 
  }) 
}
