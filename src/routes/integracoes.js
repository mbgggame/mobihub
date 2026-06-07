import { getIo } from '../server.js'

export default async function integracoesRoutes(fastify) {
  const { query } = await import('../db.js')
  const { requireAuth } = await import('./auth.js') 



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

  // GET /api/admin/gateway — retorna configuração atual
  fastify.get('/api/admin/gateway', { preHandler: requireAuth }, async (req, reply) => {
    const result = await query('SELECT * FROM gateway_config ORDER BY id DESC LIMIT 1')
    return result.rows[0] || { gateway: 'asaas', url: '', api_key: '', ativo: false }
  })

  // PUT /api/admin/gateway — salva configuração
  fastify.put('/api/admin/gateway', { preHandler: requireAuth }, async (req, reply) => {
    const { gateway, url, api_key, ativo } = req.body
    const result = await query('SELECT id FROM gateway_config ORDER BY id DESC LIMIT 1')
    if (result.rows.length > 0) {
      const updated = await query(
        'UPDATE gateway_config SET gateway = $1, url = $2, api_key = $3, ativo = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
        [gateway, url, api_key, ativo, result.rows[0].id]
      )
      return updated.rows[0]
    } else {
      const inserted = await query(
        'INSERT INTO gateway_config (gateway, url, api_key, ativo) VALUES ($1, $2, $3, $4) RETURNING *',
        [gateway, url, api_key, ativo]
      )
      return inserted.rows[0]
    }
  })

  // POST /api/pay/callback — recebe confirmação de pagamento do Zighu Pay
  fastify.post('/api/pay/callback', async (request, reply) => {
    try {
      // Valida que a requisição vem do Zighu Pay
      const zighuKey = request.headers['x-zighu-key']
      const configResult = await query('SELECT * FROM gateway_config LIMIT 1')
      const config = configResult.rows[0]

      // Só processa se Zighu Pay estiver ativo
      if (!config?.ativo) {
        return reply.code(200).send({ ok: true, msg: 'Gateway Zighu Pay inativo — ignorado' })
      }

      const { corrida_id, status, valor_total, valor_motorista, valor_plataforma, pago_em } = request.body

      if (!corrida_id || status !== 'pago') {
        return reply.code(400).send({ error: 'Dados inválidos' })
      }

      // Busca a corrida
      const rideResult = await query('SELECT * FROM rides WHERE id = $1', [corrida_id])
      const ride = rideResult.rows[0]
      if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' })

      // Verifica se é sinal de agendamento ou corrida completa 
    const isSinalAgendamento = ride.tipo === 'agendada' 
      && ride.sinal_pix_payload 
      && !ride.sinal_pago; 
    if (isSinalAgendamento) { 
      // É sinal de agendamento
        await query(
          "UPDATE rides SET sinal_pago = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
          [corrida_id]
        )
        console.log(`[ZIGHU PAY] Sinal confirmado — Corrida #${corrida_id} | R$ ${valor_total}`)

        const io = getIo()
        if (io) {
          io.to(`ride:${corrida_id}`).emit('agendamento:sinal_confirmado', {
            rideId: corrida_id,
            sinal_valor: ride.sinal_valor
          })
          const disponiveis = (await query(`
            SELECT COUNT(*) as total FROM rides
            WHERE tipo = 'agendada' AND status = 'agendada'
            AND sinal_pago = true AND driver_id IS NULL
            AND agendada_para > NOW() AT TIME ZONE 'America/Sao_Paulo'
          `)).rows[0]
          io.emit('agendamentos:atualizar', { count: parseInt(disponiveis.total) })
        }
      } else {
        // É corrida completa
        await query(
          "UPDATE rides SET pagamento_status = 'pago', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
          [corrida_id]
        )

        // Registra split no driver_transactions — igual ao webhook do Asaas
        if (ride.driver_id && valor_motorista) {
          await query(
            'INSERT INTO driver_transactions (driver_id, ride_id, tipo, descricao, valor) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
            [ride.driver_id, ride.id, 'credito', `Corrida #${ride.id} paga via Zighu Pay`, Number(valor_motorista)]
          )
        }
      }

      // Notifica via Socket.io
      try {
        const io = getIo()
        if (io) {
          // Notifica passageiro
          io.to(`ride:${corrida_id}`).emit('pagamento:confirmado', { mensagem: 'Pagamento confirmado! Obrigado' })
          // Notifica motorista — para isso precisamos buscar o driver's room? Let's just emit to ride room as well, or find driver token?
          // For now, let's emit to ride room which motorista is in too
          io.to(`ride:${corrida_id}`).emit('pagamento:confirmado', { 
            valor_motorista: Number(valor_motorista || 0), 
            mensagem: `Pix recebido! R$ ${Number(valor_motorista || 0).toFixed(2)} transferido para sua chave` 
          })
        }
      } catch(e) {}

      console.log(`[ZIGHU PAY] Pagamento confirmado — Corrida #${corrida_id} | R$ ${valor_total}`)
      return reply.send({ ok: true })

    } catch(e) {
      console.error('[ZIGHU PAY CALLBACK]', e.message)
      return reply.code(500).send({ error: 'Erro interno' })
    }
  })
} 
