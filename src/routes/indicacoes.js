import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import crypto from 'crypto'

export default async function indicacoesRoutes(fastify) {

  // Gera código único para motorista
  async function gerarCodigoMotorista(driverId, nome) {
    const base = nome.split(' ')[0].toUpperCase().substring(0, 6)
    const hash = crypto.randomBytes(3).toString('hex').toUpperCase()
    return `${base}${hash}`
  }

  // Busca ou cria código de indicação do motorista
  fastify.get('/api/motorista/:token/codigo-indicacao', async (request, reply) => {
    const driver = (await query('SELECT * FROM drivers WHERE token_perfil = $1', [request.params.token])).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' })
    if (!driver.codigo_indicacao_proprio) {
      const codigo = await gerarCodigoMotorista(driver.id, driver.nome)
      await query('UPDATE drivers SET codigo_indicacao_proprio = $1 WHERE id = $2', [codigo, driver.id])
      driver.codigo_indicacao_proprio = codigo
    }
    const config = (await query('SELECT * FROM indicacao_config LIMIT 1')).rows[0]
    const stats = (await query(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN bonus_liberado THEN 1 ELSE 0 END) as liberados,
        SUM(bonus_valor) as total_ganho
      FROM indicacoes WHERE driver_id = $1
    `, [driver.id])).rows[0]
    return {
      codigo: driver.codigo_indicacao_proprio,
      link: `${process.env.BASE_URL}/cadastro?ref=${driver.codigo_indicacao_proprio}`,
      ativo: config?.ativo || false,
      bonus_motorista: config?.bonus_motorista || 0,
      desconto_passageiro: config?.desconto_passageiro || 0,
      stats: {
        total_indicados: parseInt(stats.total || 0),
        bonus_liberados: parseInt(stats.liberados || 0),
        total_ganho: parseFloat(stats.total_ganho || 0)
      }
    }
  })

  // Valida código de indicação no cadastro do passageiro
  fastify.get('/api/indicacao/validar/:codigo', async (request, reply) => {
    const { codigo } = request.params
    const config = (await query('SELECT * FROM indicacao_config LIMIT 1')).rows[0]
    if (!config?.ativo) return { valido: false, motivo: 'Sistema de indicações inativo' }
    const driver = (await query('SELECT id, nome FROM drivers WHERE codigo_indicacao_proprio = $1', [codigo])).rows[0]
    if (!driver) return { valido: false, motivo: 'Código inválido' }
    const mesAtual = new Date().toISOString().substring(0, 7)
    const usosNoMes = (await query(`
      SELECT COUNT(*) as total FROM indicacoes
      WHERE driver_id = $1 AND TO_CHAR(created_at, 'YYYY-MM') = $2
    `, [driver.id, mesAtual])).rows[0]
    if (parseInt(usosNoMes.total) >= config.limite_mes) {
      return { valido: false, motivo: 'Limite mensal atingido' }
    }
    return {
      valido: true,
      motorista_nome: driver.nome.split(' ')[0],
      desconto: config.desconto_passageiro
    }
  })

  // Aplica código de indicação ao passageiro
  fastify.post('/api/indicacao/aplicar', async (request, reply) => {
    const { telefone, codigo } = request.body
    if (!telefone || !codigo) return reply.code(400).send({ error: 'Dados incompletos' })
    const config = (await query('SELECT * FROM indicacao_config LIMIT 1')).rows[0]
    if (!config?.ativo) return reply.code(400).send({ error: 'Sistema inativo' })
    const client = (await query('SELECT * FROM clients WHERE telefone = $1', [telefone])).rows[0]
    if (!client) return reply.code(404).send({ error: 'Cliente não encontrado' })
    if (client.codigo_indicacao_usado) return reply.code(400).send({ error: 'Código já utilizado' })
    const driver = (await query('SELECT id FROM drivers WHERE codigo_indicacao_proprio = $1', [codigo])).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Código inválido' })
    const expira = new Date()
    expira.setDate(expira.getDate() + config.validade_dias)
    await query(`
      INSERT INTO indicacoes (driver_id, client_id, codigo, expira_em, desconto_valor)
      VALUES ($1, $2, $3, $4, $5)
    `, [driver.id, client.id, codigo, expira, config.desconto_passageiro])
    await query(`
      UPDATE clients SET
        codigo_indicacao_usado = $1,
        desconto_primeira_corrida = $2,
        desconto_usado = false
      WHERE id = $3
    `, [codigo, config.desconto_passageiro, client.id])
    return { success: true, desconto: config.desconto_passageiro }
  })

  // Config indicação (admin)
  fastify.get('/api/admin/indicacao-config', { preHandler: requireAuth }, async () => {
    const config = (await query('SELECT * FROM indicacao_config LIMIT 1')).rows[0]
    return config || {}
  })

  fastify.put('/api/admin/indicacao-config', { preHandler: requireAuth }, async (request, reply) => {
    const { ativo, bonus_motorista, desconto_passageiro, min_corridas_liberar, validade_dias, limite_mes, tipo_bonus } = request.body
    await query(`
      UPDATE indicacao_config SET
        ativo = $1, bonus_motorista = $2, desconto_passageiro = $3,
        min_corridas_liberar = $4, validade_dias = $5,
        limite_mes = $6, tipo_bonus = $7, updated_at = NOW()
      WHERE id = 1
    `, [ativo, bonus_motorista, desconto_passageiro, min_corridas_liberar, validade_dias, limite_mes, tipo_bonus])
    return { success: true }
  })

  // Ranking de indicações (admin)
  fastify.get('/api/admin/indicacoes', { preHandler: requireAuth }, async () => {
    const ranking = (await query(`
      SELECT d.nome, d.codigo_indicacao_proprio,
        COUNT(i.id) as total_indicados,
        SUM(CASE WHEN i.bonus_liberado THEN 1 ELSE 0 END) as bonus_liberados,
        SUM(i.bonus_valor) as total_ganho
      FROM drivers d
      LEFT JOIN indicacoes i ON i.driver_id = d.id
      WHERE d.codigo_indicacao_proprio IS NOT NULL
      GROUP BY d.id, d.nome, d.codigo_indicacao_proprio
      ORDER BY total_indicados DESC
    `)).rows
    return { ranking }
  })
}
