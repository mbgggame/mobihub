import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export default async function adminDbRoutes(fastify) {
  fastify.get('/api/admin/db/clientes', { preHandler: requireAuth }, async () => {
    const result = await query(`
      SELECT id, nome, telefone, email, cpf, 
        aceitou_termos, versao_termos, data_aceite_termos, ip_aceite_termos,
        total_corridas, media_avaliacao, total_avaliacoes, created_at 
      FROM clients 
      ORDER BY created_at DESC
    `)
    return result.rows
  })

  fastify.get('/api/admin/db/motoristas', { preHandler: requireAuth }, async () => {
    const result = await query(`
      SELECT id, nome, telefone, cpf, 
        aceitou_termos, versao_termos, data_aceite_termos, ip_aceite_termos, aceite_arbitragem,
        modelo_carro, ano_carro, cor_carro, placa, chave_pix,
        total_viagens, media_avaliacao, total_avaliacoes, created_at 
      FROM drivers 
      ORDER BY created_at DESC
    `)
    return result.rows
  })

  fastify.get('/api/admin/db/corridas', { preHandler: requireAuth }, async () => {
    const result = await query(`
      SELECT r.id, r.status, r.pagamento_status, r.valor_final, r.valor_motorista, r.forma_pagamento, 
        r.origem, r.destino, r.created_at, r.concluida_at, r.km_reais, 
        c.nome as cliente_nome, d.nome as motorista_nome
      FROM rides r
      LEFT JOIN clients c ON r.client_id = c.id
      LEFT JOIN drivers d ON r.driver_id = d.id
      ORDER BY r.created_at DESC 
      LIMIT 50
    `)
    return result.rows
  })
}
