export default async function integracoesRoutes(fastify) { 
  const { query } = await import('../db.js') 
  const { requireAuth } = await import('./auth.js') 

  fastify.post('/webhook/asaas', async (request, reply) => { 
    const asaasToken = request.headers['asaas-access-token'] 
    if (asaasToken !== process.env.ASAAS_WEBHOOK_TOKEN) { 
      return reply.code(401).send({ error: 'Token inválido' }) 
    } 

    const { event, payment } = request.body 
    
    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') { 
      const paymentId = payment?.id 
      const externalReference = payment?.externalReference 
      
      if (paymentId && externalReference) { 
        await query( 
          "UPDATE rides SET pagamento_status = 'pago' WHERE asaas_payment_id = $1 OR id = $2", 
          [paymentId, parseInt(externalReference)] 
        ) 
      } 
    } 
    
    if (event === 'PAYMENT_OVERDUE' || event === 'PAYMENT_DELETED') { 
      const paymentId = payment?.id 
      if (paymentId) { 
        await query( 
          "UPDATE rides SET pagamento_status = 'cancelado' WHERE asaas_payment_id = $1", 
          [paymentId] 
        ) 
      } 
    } 
    
    return { received: true } 
  }) 

  // ── WEBHOOKS ────────────────────────────────────── 
 
  // Listar webhooks 
  fastify.get('/api/admin/webhooks', { preHandler: requireAuth }, async (req, reply) => { 
    const rows = (await query('SELECT * FROM webhooks ORDER BY id')).rows 
    return rows 
  }) 
 
  // Criar webhook 
  fastify.post('/api/admin/webhooks', { preHandler: requireAuth }, async (req, reply) => { 
    const { nome, url, evento, secret_key } = req.body 
    if (!nome || !url || !evento) return reply.code(400).send({ error: 'nome, url e evento são obrigatórios' }) 
    const r = (await query( 
      'INSERT INTO webhooks (nome, url, evento, secret_key) VALUES ($1, $2, $3, $4) RETURNING *', 
      [nome, url, evento, secret_key || null] 
    )).rows[0] 
    return r 
  }) 
 
  // Atualizar webhook 
  fastify.put('/api/admin/webhooks/:id', { preHandler: requireAuth }, async (req, reply) => { 
    const { nome, url, evento, secret_key, ativo } = req.body 
    const r = (await query( 
      'UPDATE webhooks SET nome=$1, url=$2, evento=$3, secret_key=$4, ativo=$5 WHERE id=$6 RETURNING *', 
      [nome, url, evento, secret_key, ativo, req.params.id] 
    )).rows[0] 
    return r 
  }) 
 
  // Deletar webhook 
  fastify.delete('/api/admin/webhooks/:id', { preHandler: requireAuth }, async (req, reply) => { 
    await query('DELETE FROM webhooks WHERE id=$1', [req.params.id]) 
    return { mensagem: 'Webhook removido' } 
  }) 
 
  // Logs de webhook 
  fastify.get('/api/admin/webhooks/logs', { preHandler: requireAuth }, async (req, reply) => { 
    const rows = (await query( 
      'SELECT * FROM webhook_logs ORDER BY created_at DESC LIMIT 50' 
    )).rows 
    return rows 
  }) 
 
  // Testar webhook manualmente 
  fastify.post('/api/admin/webhooks/:id/testar', { preHandler: requireAuth }, async (req, reply) => { 
    const wh = (await query('SELECT * FROM webhooks WHERE id=$1', [req.params.id])).rows[0] 
    if (!wh) return reply.code(404).send({ error: 'Webhook não encontrado' }) 
    const { dispararWebhook } = await import('../webhook.js') 
    await dispararWebhook(wh.evento, { 
      corrida_id: 'TESTE', 
      valor_total: 25.00, 
      motorista_id: 'TESTE', 
      motorista_nome: 'Motorista Teste', 
      lider_id: 'LIDER_TESTE', 
      finalizada_at: new Date().toISOString(), 
      _teste: true 
    }) 
    return { mensagem: 'Webhook de teste disparado' } 
  }) 
 
  // ── SPLIT FINANCEIRO ────────────────────────────── 
 
  // Listar regras de split 
  fastify.get('/api/admin/split', { preHandler: requireAuth }, async (req, reply) => { 
    return (await query('SELECT * FROM split_rules ORDER BY id')).rows 
  }) 
 
  // Criar regra de split 
  fastify.post('/api/admin/split', { preHandler: requireAuth }, async (req, reply) => { 
    const { nome, categoria, percentual_plataforma, percentual_lider, percentual_motorista, com_lider } = req.body 
    const total = parseFloat(percentual_plataforma) + parseFloat(percentual_lider) + parseFloat(percentual_motorista) 
    if (Math.abs(total - 100) > 0.01) return reply.code(400).send({ error: `Percentuais devem somar 100%. Soma atual: ${total}%` }) 
    const r = (await query( 
      'INSERT INTO split_rules (nome, categoria, percentual_plataforma, percentual_lider, percentual_motorista, com_lider) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', 
      [nome, categoria, percentual_plataforma, percentual_lider, percentual_motorista, com_lider] 
    )).rows[0] 
    return r 
  }) 

  // Atualizar regra de split 
  fastify.put('/api/admin/split/:id', { preHandler: requireAuth }, async (req, reply) => { 
    const { nome, categoria, percentual_plataforma, percentual_lider, percentual_motorista, com_lider, ativo } = req.body 
    const total = parseFloat(percentual_plataforma) + parseFloat(percentual_lider) + parseFloat(percentual_motorista) 
    if (Math.abs(total - 100) > 0.01) return reply.code(400).send({ error: `Percentuais devem somar 100%. Soma atual: ${total}%` }) 
    const r = (await query( 
      'UPDATE split_rules SET nome=$1, categoria=$2, percentual_plataforma=$3, percentual_lider=$4, percentual_motorista=$5, com_lider=$6, ativo=$7 WHERE id=$8 RETURNING *', 
      [nome, categoria, percentual_plataforma, percentual_lider, percentual_motorista, com_lider, ativo, req.params.id] 
    )).rows[0] 
    return r 
  }) 
 
  // ── CAMPO LÍDER NO MOTORISTA ────────────────────── 
 
  // Atualizar líder do motorista 
  fastify.put('/api/admin/motoristas/:id/lider', { preHandler: requireAuth }, async (req, reply) => { 
    const { lider_id, codigo_indicacao } = req.body 
    const r = (await query( 
      'UPDATE drivers SET lider_id=$1, codigo_indicacao=$2 WHERE id=$3 RETURNING id, nome, lider_id, codigo_indicacao', 
      [lider_id, codigo_indicacao, req.params.id] 
    )).rows[0] 
    return r 
  }) 
} 
