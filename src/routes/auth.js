import bcrypt from 'bcrypt' 
import { query, pool } from '../db.js' 
import { requireAuth } from '../middleware/auth.js' 

export default async function authRoutes(fastify) { 

  fastify.post('/api/login', async (request, reply) => { 
    const { email, senha } = request.body 

    if (!email || !senha) { 
      return reply.code(400).send({ error: 'Email e senha obrigatórios' }) 
    } 

    const result = await query('SELECT * FROM admins WHERE email = $1', [email]) 
    const admin = result.rows[0] 

    if (!admin) { 
      return reply.code(401).send({ error: 'Credenciais inválidas' }) 
    } 

    const ok = await bcrypt.compare(senha, admin.senha_hash) 
    if (!ok) { 
      return reply.code(401).send({ error: 'Credenciais inválidas' }) 
    } 

    const token = fastify.jwt.sign( 
      { id: admin.id, email: admin.email }, 
      { expiresIn: '8h' } 
    ) 

    return { token } 
  }) 
  
  fastify.post('/api/login/verify', async (request, reply) => {
    try {
      await request.jwtVerify()
      return reply.code(200).send({ ok: true })
    } catch(e) {
      return reply.code(401).send({ error: 'Invalid token' })
    }
  })

  // Rotas de configurações
  fastify.get('/api/configuracoes', { preHandler: requireAuth }, async () => {
    const configs = (await query('SELECT chave, valor FROM configuracoes')).rows
    const obj = {}
    configs.forEach(c => obj[c.chave] = c.valor)
    return obj
  })

  fastify.put('/api/configuracoes', { preHandler: requireAuth }, async (request, reply) => {
    const updates = request.body
    for (const [chave, valor] of Object.entries(updates)) {
      await query(
        'INSERT INTO configuracoes (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor',
        [chave, String(valor)]
      )
    }
    return { mensagem: 'Configurações salvas com sucesso!' }
  })



  // --- ROTAS DE RELATÓRIOS FINANCEIROS
  fastify.get('/api/relatorios/por-corrida', { preHandler: requireAuth }, async (request, reply) => {
    const { data_inicio, data_fim } = request.query
    let sql = `
      SELECT 
        r.id AS corrida_id,
        r.created_at AS data,
        d.nome AS motorista,
        r.valor_final AS total,
        r.valor_mobihub AS plataforma,
        r.valor_lider AS lider,
        r.valor_motorista AS motorista_valor,
        r.forma_pagamento AS forma_pagamento
      FROM rides r
      LEFT JOIN drivers d ON r.driver_id = d.id
      WHERE r.status = 'concluida'
    `
    const params = []
    let paramIndex = 1

    if (data_inicio) {
      sql += ` AND DATE(r.created_at AT TIME ZONE 'America/Sao_Paulo') >= $${paramIndex++}`
      params.push(data_inicio)
    }
    if (data_fim) {
      sql += ` AND DATE(r.created_at AT TIME ZONE 'America/Sao_Paulo') <= $${paramIndex++}`
      params.push(data_fim)
    }
    sql += ` ORDER BY r.created_at DESC`

    const result = await query(sql, params)
    return result.rows
  })

  fastify.get('/api/relatorios/por-motorista', { preHandler: requireAuth }, async (request, reply) => {
    const { data_inicio, data_fim } = request.query
    let sql = `
      SELECT 
        d.id AS motorista_id,
        d.nome AS nome,
        COUNT(r.id) AS total_corridas,
        COALESCE(SUM(r.valor_final), 0) AS total_arrecadado,
        COALESCE(SUM(r.valor_motorista), 0) AS valor_repassado,
        d.balance_due AS saldo_devedor
      FROM drivers d
      LEFT JOIN rides r ON d.id = r.driver_id AND r.status = 'concluida'
    `
    const params = []
    let paramIndex = 1
    const onConditions = []

    if (data_inicio) {
      onConditions.push(` DATE(r.created_at AT TIME ZONE 'America/Sao_Paulo') >= $${paramIndex++}`)
      params.push(data_inicio)
    }
    if (data_fim) {
      onConditions.push(` DATE(r.created_at AT TIME ZONE 'America/Sao_Paulo') <= $${paramIndex++}`)
      params.push(data_fim)
    }
    if (onConditions.length > 0) {
      // Encontrar o ponto de junção e adicionar as condições no ON
      sql = sql.replace(
        'LEFT JOIN rides r ON d.id = r.driver_id AND r.status = \'concluida\'',
        'LEFT JOIN rides r ON d.id = r.driver_id AND r.status = \'concluida\' AND ' + onConditions.join(' AND ')
      )
    }
    sql += ` GROUP BY d.id, d.nome, d.balance_due ORDER BY d.nome`

    const result = await query(sql, params)
    return result.rows
  })

  fastify.get('/api/relatorios/por-passageiro', { preHandler: requireAuth }, async (request, reply) => {
    const { data_inicio, data_fim } = request.query
    let sql = `
      SELECT 
        c.id AS passageiro_id,
        c.nome AS nome,
        COUNT(r.id) AS total_corridas,
        COALESCE(SUM(r.valor_final), 0) AS total_gasto
      FROM clients c
      LEFT JOIN rides r ON c.id = r.client_id AND r.status = 'concluida'
    `
    const params = []
    let paramIndex = 1
    const onConditions = []

    if (data_inicio) {
      onConditions.push(` DATE(r.created_at AT TIME ZONE 'America/Sao_Paulo') >= $${paramIndex++}`)
      params.push(data_inicio)
    }
    if (data_fim) {
      onConditions.push(` DATE(r.created_at AT TIME ZONE 'America/Sao_Paulo') <= $${paramIndex++}`)
      params.push(data_fim)
    }
    if (onConditions.length > 0) {
      sql = sql.replace(
        'LEFT JOIN rides r ON c.id = r.client_id AND r.status = \'concluida\'',
        'LEFT JOIN rides r ON c.id = r.client_id AND r.status = \'concluida\' AND ' + onConditions.join(' AND ')
      )
    }
    sql += ` GROUP BY c.id, c.nome ORDER BY c.nome`

    const result = await query(sql, params)
    return result.rows
  })

  fastify.get('/api/relatorios/resumo-geral', { preHandler: requireAuth }, async (request, reply) => {
    const { data_inicio, data_fim } = request.query
    let sql = `
      SELECT 
        COUNT(id) AS total_corridas,
        COALESCE(SUM(valor_final), 0) AS faturamento_total,
        COALESCE(SUM(valor_motorista), 0) AS repasse_motoristas,
        COALESCE(SUM(valor_mobihub), 0) AS comissao_plataforma,
        COALESCE(SUM(valor_lider), 0) AS comissao_lideres
      FROM rides
      WHERE status = 'concluida'
    `
    const params = []
    let paramIndex = 1

    if (data_inicio) {
      sql += ` AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo') >= $${paramIndex++}`
      params.push(data_inicio)
    }
    if (data_fim) {
      sql += ` AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo') <= $${paramIndex++}`
      params.push(data_fim)
    }

    const result = await query(sql, params)
    return result.rows[0]
  })

  // Rotas de feriados
  fastify.get('/api/feriados', { preHandler: requireAuth }, async (request, reply) => {
    const feriados = (await query('SELECT * FROM feriados ORDER BY data ASC')).rows
    return feriados
  })

  fastify.post('/api/feriados', { preHandler: requireAuth }, async (request, reply) => {
    const { data, nome, tipo } = request.body
    if (!data || !nome) return reply.code(400).send({ error: 'Data e nome são obrigatórios' })
    const result = await query(
      'INSERT INTO feriados (data, nome, tipo) VALUES ($1, $2, $3) RETURNING *',
      [data, nome, tipo || 'nacional']
    )
    return result.rows[0]
  })

  fastify.put('/api/feriados/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params
    const { data, nome, tipo } = request.body
    await query(`
      UPDATE feriados SET
        data = COALESCE($1, data),
        nome = COALESCE($2, nome),
        tipo = COALESCE($3, tipo)
      WHERE id = $4
    `, [data, nome, tipo, id])
    return { mensagem: 'Feriado atualizado com sucesso!' }
  })

  fastify.delete('/api/feriados/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params
    await query('DELETE FROM feriados WHERE id = $1', [id])
    return { mensagem: 'Feriado removido com sucesso!' }
  })

  // Endpoint temporário para remover feriados duplicados
  fastify.post('/api/temp/fix-feriados', { preHandler: requireAuth }, async (request, reply) => {
    const result = await query(`
      DELETE FROM feriados WHERE id NOT IN (SELECT MIN(id) FROM feriados GROUP BY data, nome)
    `)
    return { mensagem: 'Feriados duplicados removidos', count: result.rowCount }
  })
}
