import { v4 as uuidv4 } from 'uuid' 
import { query, pool } from '../db.js' 
import { requireAuth } from '../middleware/auth.js' 
 
export default async function driversRoutes(fastify) { 
 
  fastify.get('/api/drivers', { preHandler: requireAuth }, async () => { 
    const result = await query('SELECT id, nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, total_viagens, media_avaliacao, total_avaliacoes, ativo, foto_base64, token_perfil, created_at FROM drivers ORDER BY nome')
    return result.rows
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
      const result = await query(` 
        INSERT INTO drivers 
          (nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, foto_base64) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
        RETURNING id
      `, [nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, foto_base64 || null]) 
 
      return { id: result.rows[0].id, mensagem: 'Motorista cadastrado com sucesso' } 
    } catch (err) { 
      if (err.message.includes('unique') || err.message.includes('UNIQUE')) { 
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
 
    const driverResult = await query('SELECT id FROM drivers WHERE id = $1', [id])
    const driver = driverResult.rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    await query(` 
      UPDATE drivers SET 
        nome = COALESCE($1, nome), 
        telefone = COALESCE($2, telefone), 
        telegram_id = COALESCE($3, telegram_id),
        modelo_carro = COALESCE($4, modelo_carro), 
        ano_carro = COALESCE($5, ano_carro), 
        cor_carro = COALESCE($6, cor_carro), 
        placa = COALESCE($7, placa), 
        ativo = COALESCE($8, ativo), 
        foto_base64 = COALESCE($9, foto_base64) 
      WHERE id = $10 
    `, [nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, ativo, foto_base64, id]) 
 
    return { mensagem: 'Motorista atualizado' } 
  }) 
 
  fastify.delete('/api/drivers/:id', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    const driverResult = await query('SELECT id FROM drivers WHERE id = $1', [id])
    const driver = driverResult.rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    await query('UPDATE drivers SET ativo = 0 WHERE id = $1', [id]) 
    return { mensagem: 'Motorista desativado' } 
  }) 
 
  fastify.post('/api/drivers/:id/gerar-token', { preHandler: requireAuth }, async (request, reply) => { 
    console.log('[GERAR-TOKEN] Chamado com id:', request.params.id) 
    console.log('[GERAR-TOKEN] Headers:', request.headers.authorization ? 'JWT presente' : 'JWT ausente') 
    
    const { id } = request.params 
    const driverResult = await query('SELECT id FROM drivers WHERE id = $1', [id])
    const driver = driverResult.rows[0]
    console.log('[GERAR-TOKEN] Driver encontrado:', driver) 
    
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
    
    try { 
      const { v4: uuidv4 } = await import('uuid') 
      const novoToken = uuidv4() 
      await query('UPDATE drivers SET token_perfil = $1 WHERE id = $2', [novoToken, id]) 
      console.log('[GERAR-TOKEN] Token gerado:', novoToken) 
      return { token_perfil: novoToken, mensagem: 'Token gerado com sucesso' } 
    } catch(err) { 
      console.error('[GERAR-TOKEN] Erro:', err.message) 
      return reply.code(500).send({ error: err.message }) 
    } 
  }) 
 
  fastify.delete('/api/drivers/:id/excluir', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    const driverResult = await query('SELECT * FROM drivers WHERE id = $1', [id])
    const driver = driverResult.rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
    await query('DELETE FROM driver_locations WHERE driver_id = $1', [id]) 
    await query('DELETE FROM ratings WHERE ride_id IN (SELECT id FROM rides WHERE driver_id = $1)', [id]) 
    await query('UPDATE rides SET driver_id = NULL WHERE driver_id = $1', [id]) 
    await query('DELETE FROM drivers WHERE id = $1', [id]) 
    return { mensagem: 'Motorista excluído com sucesso' } 
  }) 
}
