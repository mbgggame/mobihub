import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export default async function adminDbRoutes(fastify) {
  fastify.get('/api/admin/db/clientes', { preHandler: requireAuth }, async () => {
    const result = await query(`
      SELECT id, nome, telefone, email, cpf, 
        aceitou_termos, versao_termos, data_aceite_termos, 
        total_corridas, created_at 
      FROM clients 
      ORDER BY created_at DESC
    `)
    return result.rows
  })

  fastify.get('/api/admin/db/motoristas', { preHandler: requireAuth }, async () => {
    const result = await query(`
      SELECT id, nome, aceitou_termos, versao_termos, data_aceite_termos, 
        aceite_arbitragem, total_viagens, created_at 
      FROM drivers 
      ORDER BY created_at DESC
    `)
    return result.rows
  })

  fastify.get('/api/admin/db/corridas', { preHandler: requireAuth }, async () => {
    const result = await query(`
      SELECT id, status, pagamento_status, valor_final, valor_motorista, valor_mobihub, 
        pago_em, created_at, origem, destino 
      FROM rides 
      ORDER BY created_at DESC 
      LIMIT 50
    `)
    return result.rows
  })
}
