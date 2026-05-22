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
      SELECT id, nome, telefone, email, cpf, renavam, crlv_base64, 
        cnh_frente_base64, cnh_verso_base64, cnh_digital_base64, foto_base64,
        modelo_carro, ano_carro, cor_carro, placa, chave_pix, tipo_chave_pix,
        cep, logradouro, numero, complemento, bairro, cidade, estado, data_nascimento,
        total_viagens, media_avaliacao, total_avaliacoes, ativo, status_cadastro,
        balance_due, lider_id, mobihub_id,
        aceitou_termos, versao_termos, data_aceite_termos, ip_aceite_termos, aceite_arbitragem,
        created_at 
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
}
