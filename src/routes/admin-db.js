import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export default async function adminDbRoutes(fastify) {
  fastify.get('/api/admin/db/clientes', { preHandler: requireAuth }, async () => {
    const result = await query(`
      SELECT * FROM clients ORDER BY created_at DESC
    `)
    return result.rows
  })

  fastify.get('/api/admin/db/motoristas', { preHandler: requireAuth }, async () => {
    const result = await query(`
      SELECT * FROM drivers ORDER BY created_at DESC
    `)
    return result.rows
  })

  fastify.get('/api/admin/db/corridas', { preHandler: requireAuth }, async () => {
    const result = await query(`
      SELECT r.*, 
        (r.valor_final - r.valor_motorista) as valor_plataforma,
        c.nome as cliente_nome, d.nome as motorista_nome
      FROM rides r
      LEFT JOIN clients c ON r.client_id = c.id
      LEFT JOIN drivers d ON r.driver_id = d.id
      ORDER BY r.created_at DESC 
      LIMIT 50
    `)
    return result.rows
  })

  fastify.get('/api/admin/db/termo/:versao', { preHandler: requireAuth }, async (request) => {
    const { versao } = request.params
    const result = await query(`
      SELECT * FROM termos_versoes WHERE versao = $1
    `, [versao])
    return result.rows[0] || null
  })
}
