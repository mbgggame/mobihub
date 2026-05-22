import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export default async function adminDbRoutes(fastify) {
  fastify.post('/api/admin/db/resetar-termos', { preHandler: requireAuth, schema: { body: {} } }, async () => {
    await query(`UPDATE drivers SET aceitou_termos = false, versao_termos = null, data_aceite_termos = null, ip_aceite_termos = null`)
    await query(`UPDATE clients SET aceitou_termos = false, versao_termos = null, data_aceite_termos = null, ip_aceite_termos = null`)
    return { success: true, mensagem: 'Termos resetados com sucesso' }
  })

  fastify.get('/api/admin/db/clientes', { preHandler: requireAuth }, async () => {
    const result = await query(`
      SELECT id, nome, telefone, email, cpf, aceitou_termos, versao_termos, 
        data_aceite_termos, ip_aceite_termos, aceite_responsabilidade, 
        total_corridas, media_avaliacao, created_at, hash_aceite_termos
      FROM clients 
      ORDER BY created_at DESC
    `)
    return result.rows
  })

  fastify.get('/api/admin/db/motoristas', { preHandler: requireAuth }, async () => {
    const result = await query(`
      SELECT id, nome, telefone, cpf, cnh_frente_base64, modelo_carro, ano_carro, 
        cor_carro, placa, chave_pix, media_avaliacao, total_viagens, 
        aceitou_termos, versao_termos, data_aceite_termos, ip_aceite_termos, 
        aceite_arbitragem, created_at, hash_aceite_termos
      FROM drivers 
      ORDER BY created_at DESC
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
