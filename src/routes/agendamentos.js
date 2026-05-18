import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

async function criarCobrancaAsaas(valor, descricao, externalRef, dueDate) {
  if (!process.env.ASAAS_API_KEY) return null
  const response = await fetch('https://www.asaas.com/api/v3/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'access_token': process.env.ASAAS_API_KEY },
    body: JSON.stringify({ billingType: 'PIX', value: valor, dueDate, description: descricao, externalReference: externalRef })
  })
  return response.json()
}

async function buscarPixPayload(chargeId) {
  if (!process.env.ASAAS_API_KEY || !chargeId) return null
  try {
    const r = await fetch(`https://www.asaas.com/api/v3/payments/${chargeId}/pixQrCode`, {
      headers: { 'access_token': process.env.ASAAS_API_KEY }
    })
    const data = await r.json()
    return data.payload || null
  } catch { return null }
}

async function estornarCobranca(chargeId, valor) {
  if (!process.env.ASAAS_API_KEY || !chargeId) return null
  const r = await fetch(`https://www.asaas.com/api/v3/payments/${chargeId}/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'access_token': process.env.ASAAS_API_KEY },
    body: JSON.stringify({ value: valor, description: 'Cancelamento de agendamento MobiHub' })
  })
  return r.json()
}

export async function gerarCobrancaRestante(ride) {
  if (!ride.sinal_pago || !ride.sinal_valor || ride.tipo !== 'agendada') return null
  const valorTotal = parseFloat(ride.valor_final || ride.valor || 0)
  const restante = parseFloat((valorTotal - parseFloat(ride.sinal_valor)).toFixed(2))
  if (restante <= 0) return null

  const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const charge = await criarCobrancaAsaas(
    restante,
    `Saldo corrida MobiHub #${ride.id} - ${ride.origem} → ${ride.destino}`,
    `restante_${ride.id}`,
    dueDate
  )
  if (!charge?.id) return null

  const pixPayload = await buscarPixPayload(charge.id)
  await query(
    'UPDATE rides SET asaas_payment_id = $1, asaas_pix_payload = $2, pagamento_status = $3 WHERE id = $4',
    [charge.id, pixPayload, 'aguardando_pagamento', ride.id]
  )
  return { charge_id: charge.id, pix_payload: pixPayload, valor_restante: restante }
}

export default async function agendamentosRoutes(fastify) {

  // Passageiro cria agendamento e recebe PIX do sinal (30%)
  fastify.post('/api/agendar', async (request, reply) => {
    const {
      origem, origem_lat, origem_lng,
      destino, destino_lat, destino_lng,
      valor_estimado, agendada_para,
      nome_cliente, telefone_cliente, client_id
    } = request.body

    if (!origem || !destino || !agendada_para || !valor_estimado) {
      return reply.code(400).send({ error: 'Campos obrigatórios: origem, destino, agendada_para, valor_estimado' })
    }

    const agendadaParaDate = new Date(agendada_para)
    if (isNaN(agendadaParaDate.getTime()) || agendadaParaDate <= new Date()) {
      return reply.code(400).send({ error: 'Data/hora do agendamento deve ser futura' })
    }

    let clientId = client_id
    if (!clientId && telefone_cliente) {
      const existing = (await query('SELECT id FROM clients WHERE telefone = $1', [telefone_cliente])).rows[0]
      if (existing) {
        clientId = existing.id
      } else if (nome_cliente) {
        const novo = (await query(
          'INSERT INTO clients (nome, telefone) VALUES ($1, $2) RETURNING id',
          [nome_cliente, telefone_cliente]
        )).rows[0]
        clientId = novo.id
      }
    }

    const { v4: uuidv4 } = await import('uuid')
    const token = uuidv4()
    const valorEstimado = parseFloat(parseFloat(valor_estimado).toFixed(2))
    const sinalValor = parseFloat((valorEstimado * 0.30).toFixed(2))

    const result = await query(`
      INSERT INTO rides
        (token, client_id, origem, origem_lat, origem_lng,
         destino, destino_lat, destino_lng,
         valor, tipo, agendada_para, status, forma_pagamento,
         sinal_valor, sinal_pago)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'agendada', $10, 'agendada', 'PIX', $11, false)
      RETURNING id
    `, [token, clientId || null, origem, origem_lat || null, origem_lng || null,
        destino, destino_lat || null, destino_lng || null,
        valorEstimado, agendadaParaDate.toISOString(), sinalValor])

    const rideId = result.rows[0].id
    let pixPayload = null
    let chargeId = null

    if (process.env.ASAAS_API_KEY) {
      try {
        const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        const charge = await criarCobrancaAsaas(
          sinalValor,
          `Sinal agendamento MobiHub #${rideId} - ${origem} → ${destino}`,
          `sinal_${rideId}`,
          dueDate
        )
        if (charge?.id) {
          chargeId = charge.id
          pixPayload = await buscarPixPayload(chargeId)
          await query(
            'UPDATE rides SET sinal_charge_id = $1, sinal_pix_payload = $2 WHERE id = $3',
            [chargeId, pixPayload, rideId]
          )
        }
      } catch (err) {
        console.error('[AGENDAR] Erro Asaas:', err.message)
      }
    }

    return {
      id: rideId,
      token,
      link: `${process.env.BASE_URL}/r/${token}`,
      sinal_valor: sinalValor,
      valor_total: valorEstimado,
      pix_payload: pixPayload,
      charge_id: chargeId,
      agendada_para: agendadaParaDate.toISOString(),
      mensagem: 'Agendamento criado! Pague o sinal via PIX para confirmar.'
    }
  })

  // Status do agendamento (passageiro consulta)
  fastify.get('/api/agendar/:token/status', async (request, reply) => {
    const ride = (await query(`
      SELECT r.id, r.token, r.origem, r.destino, r.valor, r.sinal_valor, r.sinal_pago,
             r.sinal_pix_payload, r.agendada_para, r.status,
             c.nome as client_nome,
             d.nome as driver_nome, d.telefone as driver_telefone,
             d.modelo_carro, d.cor_carro, d.placa
      FROM rides r
      LEFT JOIN clients c ON r.client_id = c.id
      LEFT JOIN drivers d ON r.driver_id = d.id
      WHERE r.token = $1 AND r.tipo = 'agendada'
    `, [request.params.token])).rows[0]
    if (!ride) return reply.code(404).send({ error: 'Agendamento não encontrado' })
    return ride
  })

  // Motorista lista agendamentos disponíveis (sinal pago, sem driver)
  fastify.get('/api/motorista/:token/agendamentos', async (request, reply) => {
    const driver = (await query(
      'SELECT id, bloqueado_agendamento_ate FROM drivers WHERE token_perfil = $1 AND ativo = 1',
      [request.params.token]
    )).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' })

    const bloqueadoAte = driver.bloqueado_agendamento_ate
    const bloqueado = bloqueadoAte && new Date(bloqueadoAte) > new Date()

    const agendamentos = (await query(`
      SELECT r.id, r.token, r.origem, r.destino, r.valor, r.sinal_valor,
             r.agendada_para, r.status, r.driver_id,
             c.nome as client_nome
      FROM rides r
      LEFT JOIN clients c ON r.client_id = c.id
      WHERE r.tipo = 'agendada'
        AND r.status = 'agendada'
        AND r.sinal_pago = true
        AND r.agendada_para > NOW()
      ORDER BY r.agendada_para ASC
    `)).rows

    // Agendamentos aceitos por ESTE motorista
    const meus = (await query(`
      SELECT r.id, r.token, r.origem, r.destino, r.valor, r.sinal_valor,
             r.agendada_para, r.status
      FROM rides r
      WHERE r.tipo = 'agendada'
        AND r.driver_id = $1
        AND r.status = 'agendada_aceita'
        AND r.agendada_para > NOW()
      ORDER BY r.agendada_para ASC
    `, [driver.id])).rows

    return {
      disponiveis: agendamentos,
      meus_agendamentos: meus,
      bloqueado,
      bloqueado_ate: bloqueadoAte
    }
  })

  // Motorista aceita agendamento
  fastify.post('/api/motorista/:token/agendamentos/:id/aceitar', async (request, reply) => {
    const driver = (await query(
      'SELECT id, bloqueado_agendamento_ate FROM drivers WHERE token_perfil = $1 AND ativo = 1',
      [request.params.token]
    )).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' })

    if (driver.bloqueado_agendamento_ate && new Date(driver.bloqueado_agendamento_ate) > new Date()) {
      const ate = new Date(driver.bloqueado_agendamento_ate).toLocaleDateString('pt-BR')
      return reply.code(403).send({ error: `Você está bloqueado de aceitar agendamentos até ${ate} por não comparecimento anterior.` })
    }

    const ride = (await query(
      "SELECT * FROM rides WHERE id = $1 AND tipo = 'agendada' AND status = 'agendada' AND sinal_pago = true",
      [request.params.id]
    )).rows[0]
    if (!ride) return reply.code(404).send({ error: 'Agendamento não disponível ou sinal não confirmado' })

    await query(
      "UPDATE rides SET status = 'agendada_aceita', driver_id = $1, aceita_at = CURRENT_TIMESTAMP WHERE id = $2",
      [driver.id, ride.id]
    )

    try {
      const { getBot } = await import('../telegram.js')
      const bot = getBot()
      if (bot && ride.client_id) {
        const client = (await query('SELECT telegram_id FROM clients WHERE id = $1', [ride.client_id])).rows[0]
        const driverInfo = (await query('SELECT nome, modelo_carro, cor_carro, placa FROM drivers WHERE id = $1', [driver.id])).rows[0]
        if (client?.telegram_id && driverInfo) {
          const dataHora = new Date(ride.agendada_para).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
          bot.sendMessage(client.telegram_id,
            `✅ *Agendamento confirmado!*\n\n📅 ${dataHora}\n🚗 Motorista: ${driverInfo.nome}\n🚙 ${driverInfo.modelo_carro} ${driverInfo.cor_carro} - ${driverInfo.placa}`,
            { parse_mode: 'Markdown' }
          ).catch(() => {})
        }
      }
    } catch (e) {
      console.error('[AGENDAMENTO ACEITAR] Notificação:', e.message)
    }

    return { mensagem: 'Agendamento aceito com sucesso!' }
  })

  // Motorista recusa/desiste do agendamento (volta para a fila)
  fastify.post('/api/motorista/:token/agendamentos/:id/recusar', async (request, reply) => {
    const driver = (await query(
      'SELECT id FROM drivers WHERE token_perfil = $1 AND ativo = 1',
      [request.params.token]
    )).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' })

    const ride = (await query(
      "SELECT * FROM rides WHERE id = $1 AND driver_id = $2 AND status = 'agendada_aceita'",
      [request.params.id, driver.id]
    )).rows[0]
    if (!ride) return reply.code(404).send({ error: 'Agendamento não encontrado' })

    await query(
      "UPDATE rides SET status = 'agendada', driver_id = NULL, aceita_at = NULL WHERE id = $1",
      [ride.id]
    )

    return { mensagem: 'Agendamento recusado. A corrida voltou para a fila.' }
  })

  // Motorista confirma presença no dia → ride vira aberta
  fastify.post('/api/motorista/:token/agendamentos/:id/confirmar-presenca', async (request, reply) => {
    const driver = (await query(
      'SELECT id FROM drivers WHERE token_perfil = $1 AND ativo = 1',
      [request.params.token]
    )).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' })

    const ride = (await query(
      "SELECT * FROM rides WHERE id = $1 AND driver_id = $2 AND status = 'agendada_aceita'",
      [request.params.id, driver.id]
    )).rows[0]
    if (!ride) return reply.code(404).send({ error: 'Agendamento não encontrado' })

    await query(
      "UPDATE rides SET status = 'aberta', disparada_at = CURRENT_TIMESTAMP WHERE id = $1",
      [ride.id]
    )

    try {
      const { getBot } = await import('../telegram.js')
      const bot = getBot()
      if (bot && ride.client_id) {
        const client = (await query('SELECT telegram_id FROM clients WHERE id = $1', [ride.client_id])).rows[0]
        const driverInfo = (await query(
          'SELECT nome, modelo_carro, cor_carro, placa, telefone FROM drivers WHERE id = $1',
          [driver.id]
        )).rows[0]
        if (client?.telegram_id && driverInfo) {
          bot.sendMessage(client.telegram_id,
            `🚗 *Seu motorista confirmou presença e está a caminho!*\n\n👤 ${driverInfo.nome}\n🚙 ${driverInfo.modelo_carro} ${driverInfo.cor_carro} - ${driverInfo.placa}\n📞 ${driverInfo.telefone || ''}`,
            { parse_mode: 'Markdown' }
          ).catch(() => {})
        }
      }
    } catch (e) {
      console.error('[CONFIRMAR PRESENÇA] Notificação:', e.message)
    }

    return { mensagem: 'Presença confirmada! Corrida aberta para o passageiro.' }
  })

  // Passageiro cancela agendamento
  fastify.post('/api/ride/:token/cancelar-agendamento', async (request, reply) => {
    const { opcao_reembolso } = request.body // 'estorno' | 'creditos'

    const ride = (await query(
      "SELECT * FROM rides WHERE token = $1 AND tipo = 'agendada' AND status IN ('agendada', 'agendada_aceita')",
      [request.params.token]
    )).rows[0]
    if (!ride) return reply.code(404).send({ error: 'Agendamento não encontrado ou não pode ser cancelado' })

    const horasRestantes = (new Date(ride.agendada_para) - new Date()) / (1000 * 60 * 60)
    const temDireitoReembolso = horasRestantes > 2 && ride.sinal_pago && parseFloat(ride.sinal_valor) > 0

    let reembolsoFeito = false
    let mensagemReembolso = ''

    if (temDireitoReembolso) {
      const sinalValor = parseFloat(ride.sinal_valor)

      if (opcao_reembolso === 'estorno') {
        if (!ride.sinal_charge_id) {
          return reply.code(400).send({ error: 'ID da cobrança não encontrado para estorno' })
        }
        try {
          const estorno = await estornarCobranca(ride.sinal_charge_id, sinalValor)
          if (estorno?.id || estorno?.refunds?.length > 0) {
            await query('UPDATE rides SET sinal_estornado = true WHERE id = $1', [ride.id])
            reembolsoFeito = true
            mensagemReembolso = `Estorno de R$ ${sinalValor.toFixed(2)} solicitado. Prazo: até 5 dias úteis.`
          } else {
            return reply.code(500).send({ error: 'Erro ao processar estorno bancário. Tente créditos MobiHub.' })
          }
        } catch (e) {
          console.error('[CANCELAR AGENDAMENTO] Erro estorno:', e.message)
          return reply.code(500).send({ error: 'Erro ao processar estorno.' })
        }
      } else if (opcao_reembolso === 'creditos') {
        if (!ride.client_id) return reply.code(400).send({ error: 'Cliente não identificado' })
        await query('UPDATE clients SET creditos = creditos + $1 WHERE id = $2', [sinalValor, ride.client_id])
        reembolsoFeito = true
        mensagemReembolso = `R$ ${sinalValor.toFixed(2)} adicionados como créditos MobiHub.`
      } else {
        // Sem opcao_reembolso: informa as opções disponíveis
        return reply.send({
          tem_direito_reembolso: true,
          sinal_valor: sinalValor,
          opcoes: ['estorno', 'creditos'],
          mensagem: 'Escolha a opção de reembolso: "estorno" (bancário, até 5 dias) ou "creditos" (imediato na carteira MobiHub).'
        })
      }
    }

    await query(
      "UPDATE rides SET status = 'cancelada', cancelada_at = CURRENT_TIMESTAMP, cancelado_por = 'passageiro' WHERE id = $1",
      [ride.id]
    )

    // Notifica motorista se já havia aceito
    if (ride.driver_id) {
      try {
        const { getBot } = await import('../telegram.js')
        const bot = getBot()
        const driver = (await query('SELECT telegram_id FROM drivers WHERE id = $1', [ride.driver_id])).rows[0]
        if (bot && driver?.telegram_id) {
          const dataHora = new Date(ride.agendada_para).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
          bot.sendMessage(driver.telegram_id,
            `❌ *Agendamento cancelado pelo passageiro*\n\n📍 ${ride.origem} → ${ride.destino}\n📅 ${dataHora}`,
            { parse_mode: 'Markdown' }
          ).catch(() => {})
        }
      } catch (e) { /* silently ignore */ }
    }

    return {
      mensagem: 'Agendamento cancelado com sucesso.',
      reembolso: reembolsoFeito
        ? mensagemReembolso
        : (horasRestantes <= 2 ? 'Cancelamento com menos de 2h — sinal não reembolsável.' : 'Sinal ainda não havia sido pago.'),
      tem_direito_reembolso: temDireitoReembolso
    }
  })

  // Admin: listar agendamentos
  fastify.get('/api/admin/agendamentos', { preHandler: requireAuth }, async (request, reply) => {
    const { status } = request.query
    let sql = `
      SELECT r.id, r.token, r.origem, r.destino, r.valor, r.sinal_valor, r.sinal_pago,
             r.agendada_para, r.status, r.created_at, r.cancelado_por,
             c.nome as client_nome, c.telefone as client_telefone,
             d.nome as driver_nome, d.telefone as driver_telefone, d.placa
      FROM rides r
      LEFT JOIN clients c ON r.client_id = c.id
      LEFT JOIN drivers d ON r.driver_id = d.id
      WHERE r.tipo = 'agendada'
    `
    const params = []
    if (status) { sql += ' AND r.status = $1'; params.push(status) }
    sql += ' ORDER BY r.agendada_para DESC'
    return (await query(sql, params)).rows
  })

  // Admin: registrar não comparecimento do motorista
  fastify.post('/api/admin/agendamentos/:id/nao-compareceu', { preHandler: requireAuth }, async (request, reply) => {
    const ride = (await query(
      "SELECT * FROM rides WHERE id = $1 AND tipo = 'agendada' AND status = 'agendada_aceita'",
      [request.params.id]
    )).rows[0]
    if (!ride) return reply.code(404).send({ error: 'Agendamento não encontrado ou status inválido' })

    if (ride.driver_id) {
      await query(
        "UPDATE drivers SET bloqueado_agendamento_ate = NOW() + INTERVAL '1 month' WHERE id = $1",
        [ride.driver_id]
      )
    }

    await query(
      "UPDATE rides SET status = 'cancelada', cancelada_at = CURRENT_TIMESTAMP, cancelado_por = 'driver_nao_compareceu' WHERE id = $1",
      [ride.id]
    )

    // Reembolsa passageiro automaticamente em créditos
    if (ride.client_id && ride.sinal_pago && parseFloat(ride.sinal_valor) > 0) {
      await query('UPDATE clients SET creditos = creditos + $1 WHERE id = $2', [ride.sinal_valor, ride.client_id])
      try {
        const { getBot } = await import('../telegram.js')
        const bot = getBot()
        const client = (await query('SELECT telegram_id FROM clients WHERE id = $1', [ride.client_id])).rows[0]
        if (bot && client?.telegram_id) {
          bot.sendMessage(client.telegram_id,
            `⚠️ *Infelizmente o motorista não compareceu ao seu agendamento.*\n\nR$ ${parseFloat(ride.sinal_valor).toFixed(2)} foram creditados na sua carteira MobiHub.\n\nDesculpe o transtorno!`,
            { parse_mode: 'Markdown' }
          ).catch(() => {})
        }
      } catch (e) { /* silently ignore */ }
    }

    return {
      mensagem: 'Motorista marcado como não comparecido. Corrida cancelada, motorista bloqueado por 1 mês.',
      creditos_restituidos: ride.sinal_pago ? parseFloat(ride.sinal_valor) : 0
    }
  })

  // Admin: desbloquear motorista manualmente
  fastify.post('/api/admin/drivers/:id/desbloquear-agendamento', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params
    await query('UPDATE drivers SET bloqueado_agendamento_ate = NULL WHERE id = $1', [id])
    return { mensagem: 'Motorista desbloqueado para agendamentos.' }
  })
}
