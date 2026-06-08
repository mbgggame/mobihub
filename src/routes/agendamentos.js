import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { getIo } from '../server.js'

export async function criarCobrancaAsaas(valor, descricao, externalRef, dueDate, billingType = 'PIX', customerId = null, creditCardToken = null) {
  if (!process.env.ASAAS_API_KEY) return null
  const body = { billingType, value: valor, dueDate, description: descricao, externalReference: externalRef }
  if (customerId) body.customer = customerId
  if (billingType === 'CREDIT_CARD' && creditCardToken) body.creditCardToken = creditCardToken
  const response = await fetch('https://www.asaas.com/api/v3/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'access_token': process.env.ASAAS_API_KEY },
    body: JSON.stringify(body)
  })
  return response.json()
}

export async function buscarPixPayload(chargeId) {
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

  try {
    const gatewayConfig = (await query('SELECT * FROM gateway_config LIMIT 1')).rows[0]
    if (!gatewayConfig?.ativo || gatewayConfig?.gateway !== 'zighu') return null

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    const zighuRes = await fetch(`${gatewayConfig.url}/zighu/cobranca`, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': gatewayConfig.api_key
      },
      body: JSON.stringify({
        corrida_id: ride.id,
        valor: restante,
        motorista_id: ride.driver_id,
        chave_pix: ride.chave_pix_motorista || null,
        percentual_motorista: 80,
        app_origem: 'mobihub'
      })
    })
    const zighuData = await zighuRes.json()
    clearTimeout(timeout)
    console.log('[ZIGHU RESTANTE] resposta:', JSON.stringify(zighuData))

    if (zighuData.pix_copia_cola) {
      await query(
        'UPDATE rides SET zighu_payment_id = $1, zighu_pix_payload = $2, zighu_pix_qrcode = $3, pagamento_status = $4 WHERE id = $5',
        [String(zighuData.cobranca_id), zighuData.pix_copia_cola, zighuData.qr_code, 'aguardando_pagamento', ride.id]
      )
      const io = getIo()
      if (io) {
        io.to(`ride:${ride.id}`).emit('agendamento:cobranca_restante', {
          rideId: ride.id,
          valor_restante: restante,
          pix_payload: zighuData.pix_copia_cola
        })
      }
      return { pix_payload: zighuData.pix_copia_cola, valor_restante: restante }
    }
  } catch(e) {
    console.error('[ZIGHU RESTANTE] Erro:', e.message)
  }
  return null
}

export default async function agendamentosRoutes(fastify) {

  // Passageiro cria agendamento e recebe PIX do sinal (30%)
  fastify.post('/api/agendar', async (request, reply) => {
    const {
      origem, origem_lat, origem_lng,
      destino, destino_lat, destino_lng,
      valor_estimado, agendada_para,
      nome_cliente, telefone_cliente, client_id,
      forma_pagamento
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'agendada', $10, 'agendada', $11, $12, false)
      RETURNING id
    `, [token, clientId || null, origem, origem_lat || null, origem_lng || null,
        destino, destino_lat || null, destino_lng || null,
        valorEstimado, agendadaParaDate.toISOString(), forma_pagamento || 'PIX', sinalValor])

    const rideId = result.rows[0].id
    let pixPayload = null
    let chargeId = null

    try {
      const gatewayConfig = (await query('SELECT * FROM gateway_config LIMIT 1')).rows[0]
      if (gatewayConfig?.ativo && gatewayConfig?.gateway === 'zighu') {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        const zighuRes = await fetch(`${gatewayConfig.url}/zighu/cobranca-sinal`, {
          signal: controller.signal,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': gatewayConfig.api_key
          },
          body: JSON.stringify({
            corrida_id: rideId,
            valor: sinalValor,
            descricao: `Sinal agendamento MobiHub #${rideId} - ${origem} → ${destino}`,
            app_origem: 'mobihub'
          })
        })
        const zighuData = await zighuRes.json()
        clearTimeout(timeout)
        console.log('[ZIGHU SINAL] resposta:', JSON.stringify(zighuData))
        if (zighuData.pix_copia_cola) {
          pixPayload = zighuData.pix_copia_cola
          chargeId = zighuData.cobranca_id
          await query(
            'UPDATE rides SET sinal_charge_id = $1, sinal_pix_payload = $2 WHERE id = $3',
            [chargeId, pixPayload, rideId]
          )
        }
      }
    } catch (err) {
      console.error('[AGENDAR] Erro Zighu:', err.message)
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

  // Motorista lista agendamentos disponíveis (sinal pago, sem driver) e os seus
  fastify.get('/api/motorista/:token/agendamentos', async (request, reply) => {
    const driver = (await query(
      'SELECT id, bloqueado_agendamento_ate FROM drivers WHERE token_perfil = $1 AND ativo = 1',
      [request.params.token]
    )).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' })

    const bloqueadoAte = driver.bloqueado_agendamento_ate
    const bloqueado = bloqueadoAte && new Date(bloqueadoAte) > new Date()

    const disponiveis = (await query(`
      SELECT r.id, r.token, r.origem, r.destino, r.valor, r.sinal_valor,
             r.agendada_para, r.status,
             c.nome as client_nome
      FROM rides r
      LEFT JOIN clients c ON r.client_id = c.id
      WHERE r.tipo = 'agendada'
        AND r.status = 'agendada'
        AND r.sinal_pago = true
        AND r.agendada_para > NOW() AT TIME ZONE 'America/Sao_Paulo'
      ORDER BY r.agendada_para ASC
    `)).rows

    const meus = (await query(`
      SELECT r.id, r.token, r.origem, r.destino, r.valor, r.sinal_valor,
             r.agendada_para, r.status,
             c.nome as client_nome
      FROM rides r
      LEFT JOIN clients c ON r.client_id = c.id
      WHERE r.tipo = 'agendada'
        AND r.driver_id = $1
        AND r.status = 'agendada_aceita'
        AND r.agendada_para > NOW() AT TIME ZONE 'America/Sao_Paulo'
      ORDER BY r.agendada_para ASC
    `, [driver.id])).rows

    return { disponiveis, meus_agendamentos: meus, bloqueado, bloqueado_ate: bloqueadoAte }
  })

  // Motorista aceita agendamento
  fastify.post('/api/motorista/:token/agendamentos/:id/aceitar', async (request, reply) => {
    const driver = (await query(
      'SELECT id, nome, modelo_carro, cor_carro, placa, bloqueado_agendamento_ate FROM drivers WHERE token_perfil = $1 AND ativo = 1',
      [request.params.token]
    )).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' })

    if (driver.bloqueado_agendamento_ate && new Date(driver.bloqueado_agendamento_ate) > new Date()) {
      const ate = new Date(driver.bloqueado_agendamento_ate).toLocaleDateString('pt-BR')
      return reply.code(403).send({ error: `Você está bloqueado de aceitar agendamentos até ${ate}.` })
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

    const io = getIo()
    if (io) {
      io.to(`ride:${ride.id}`).emit('agendamento:aceito', {
        rideId: ride.id,
        driver_nome: driver.nome,
        modelo_carro: driver.modelo_carro,
        cor_carro: driver.cor_carro,
        placa: driver.placa
      })
      // Atualizar badge para todos motoristas 
      const disponiveis = (await query(` 
        SELECT COUNT(*) as total FROM rides 
        WHERE tipo = 'agendada' AND status = 'agendada' 
        AND sinal_pago = true AND driver_id IS NULL AND agendada_para > NOW() AT TIME ZONE 'America/Sao_Paulo' 
      `)).rows[0] 
      io.emit('agendamentos:atualizar', { count: parseInt(disponiveis.total) }) 
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
      "SELECT id FROM rides WHERE id = $1 AND driver_id = $2 AND status = 'agendada_aceita'",
      [request.params.id, driver.id]
    )).rows[0]
    if (!ride) return reply.code(404).send({ error: 'Agendamento não encontrado' })

    await query(
      "UPDATE rides SET status = 'agendada', driver_id = NULL, aceita_at = NULL WHERE id = $1",
      [ride.id]
    )

    const io = getIo()
    if (io) {
      // Atualizar badge para todos motoristas 
      const disponiveis = (await query(` 
        SELECT COUNT(*) as total FROM rides 
        WHERE tipo = 'agendada' AND status = 'agendada' 
        AND sinal_pago = true AND driver_id IS NULL AND agendada_para > NOW() AT TIME ZONE 'America/Sao_Paulo' 
      `)).rows[0] 
      io.emit('agendamentos:atualizar', { count: parseInt(disponiveis.total) }) 
    }

    return { mensagem: 'Agendamento recusado. A corrida voltou para a fila.' }
  })

  // Motorista confirma presença no dia → ride vira aberta
  fastify.post('/api/motorista/:token/agendamentos/:id/confirmar-presenca', async (request, reply) => {
    const driver = (await query(
      'SELECT id, nome, modelo_carro, cor_carro, placa, telefone FROM drivers WHERE token_perfil = $1 AND ativo = 1',
      [request.params.token]
    )).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' })

    const ride = (await query(
      "SELECT * FROM rides WHERE id = $1 AND driver_id = $2 AND status = 'agendada_aceita'",
      [request.params.id, driver.id]
    )).rows[0]
    if (!ride) return reply.code(404).send({ error: 'Agendamento não encontrado' })

    await query(
      "UPDATE rides SET status = 'aberta', disparada_at = CURRENT_TIMESTAMP, confirmou_presenca = CURRENT_TIMESTAMP WHERE id = $1",
      [ride.id]
    )

    const io = getIo()
    if (io) {
      io.to(`ride:${ride.id}`).emit('agendamento:presenca_confirmada', {
        rideId: ride.id,
        driver_nome: driver.nome,
        modelo_carro: driver.modelo_carro,
        cor_carro: driver.cor_carro,
        placa: driver.placa,
        telefone: driver.telefone
      })
    }

    return { mensagem: 'Presença confirmada! Corrida aberta para o passageiro.' }
  })

  // Passageiro cancela agendamento (>2h antes = reembolso disponível)
  fastify.post('/api/ride/:token/cancelar-agendamento', async (request, reply) => {
    const { opcao_reembolso } = request.body || {} // 'estorno' | 'creditos'

    const ride = (await query(
      "SELECT * FROM rides WHERE token = $1 AND tipo = 'agendada' AND status IN ('agendada', 'agendada_aceita')",
      [request.params.token]
    )).rows[0]
    if (!ride) return reply.code(404).send({ error: 'Agendamento não encontrado ou não pode ser cancelado' })

    const horasRestantes = (new Date(ride.agendada_para) - new Date()) / (1000 * 60 * 60)
    const sinalValor = parseFloat(ride.sinal_valor || 0)
    const temDireitoReembolso = ride.sinal_pago && sinalValor > 0

    let reembolsoFeito = false
    let mensagemReembolso = ''

    if (temDireitoReembolso && !opcao_reembolso) {
      return reply.send({
        tem_direito_reembolso: true,
        sinal_valor: sinalValor,
        opcoes: ['estorno', 'creditos'],
        mensagem: 'Escolha: "estorno" (bancário, até 5 dias úteis) ou "creditos" (imediato na carteira MobiHub).'
      })
    }

    if (temDireitoReembolso) {
      if (opcao_reembolso === 'estorno') {
        if (!ride.sinal_charge_id) {
          return reply.code(400).send({ error: 'ID da cobrança não encontrado para estorno' })
        }
        const estorno = await estornarCobranca(ride.sinal_charge_id, sinalValor)
        if (estorno?.id || estorno?.refunds?.length > 0) {
          await query('UPDATE rides SET sinal_estornado = true WHERE id = $1', [ride.id])
          reembolsoFeito = true
          mensagemReembolso = `Estorno de R$ ${sinalValor.toFixed(2)} solicitado. Prazo: até 5 dias úteis.`
        } else {
          return reply.code(500).send({ error: 'Erro ao processar estorno. Tente a opção créditos.' })
        }
      } else if (opcao_reembolso === 'creditos') {
        if (!ride.client_id) return reply.code(400).send({ error: 'Cliente não identificado' })
        await query('UPDATE clients SET creditos = creditos + $1 WHERE id = $2', [sinalValor, ride.client_id])
        reembolsoFeito = true
        mensagemReembolso = `R$ ${sinalValor.toFixed(2)} adicionados na sua carteira MobiHub.`
      }
    }

    await query(
      "UPDATE rides SET status = 'cancelada', cancelada_at = CURRENT_TIMESTAMP, cancelado_por = 'passageiro' WHERE id = $1",
      [ride.id]
    )

    const io = getIo()
    if (io) {
      io.to(`ride:${ride.id}`).emit('agendamento:cancelado', {
        rideId: ride.id,
        motivo: 'passageiro_cancelou',
        reembolso: mensagemReembolso
      })
      // Notifica motorista na sala dele, se havia aceito
      if (ride.driver_id) {
        io.to(`motorista:${ride.driver_id}`).emit('agendamento:cancelado', {
          rideId: ride.id,
          motivo: 'passageiro_cancelou'
        })
      }
    }

    return {
      mensagem: 'Agendamento cancelado.',
      reembolso: reembolsoFeito
        ? mensagemReembolso
        : (horasRestantes <= 2 ? 'Cancelamento com menos de 2h — sinal não reembolsável.' : 'Sinal ainda não havia sido pago.'),
      tem_direito_reembolso: temDireitoReembolso
    }
  })

  // Passageiro lista seus agendamentos
  fastify.get('/api/cliente/:clienteId/agendamentos', async (request, reply) => {
    const agendamentos = (await query(`
      SELECT r.id, r.token, r.origem, r.destino, r.valor, r.agendada_para, r.status,
             d.nome as driver_nome
      FROM rides r
      LEFT JOIN drivers d ON r.driver_id = d.id
      WHERE r.client_id = $1 
      AND r.tipo = 'agendada' 
      AND r.status NOT IN ('concluida', 'cancelada') 
      ORDER BY r.agendada_para ASC
    `, [request.params.clienteId])).rows
    return { agendamentos }
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

    let creditosRestituidos = 0
    if (ride.client_id && ride.sinal_pago && parseFloat(ride.sinal_valor || 0) > 0) {
      await query('UPDATE clients SET creditos = creditos + $1 WHERE id = $2', [ride.sinal_valor, ride.client_id])
      creditosRestituidos = parseFloat(ride.sinal_valor)
    }

    const io = getIo()
    if (io) {
      io.to(`ride:${ride.id}`).emit('agendamento:cancelado', {
        rideId: ride.id,
        motivo: 'driver_nao_compareceu',
        creditos_restituidos: creditosRestituidos
      })
    }

    return {
      mensagem: 'Motorista marcado como não comparecido. Corrida cancelada e motorista bloqueado por 1 mês.',
      creditos_restituidos: creditosRestituidos
    }
  })

  // Admin: desbloquear motorista manualmente
  fastify.post('/api/admin/drivers/:id/desbloquear-agendamento', { preHandler: requireAuth }, async (request, reply) => {
    await query('UPDATE drivers SET bloqueado_agendamento_ate = NULL WHERE id = $1', [request.params.id])
    return { mensagem: 'Motorista desbloqueado para agendamentos.' }
  })

  // Admin: simular pagamento do sinal de agendamento
  fastify.post('/api/admin/agendamentos/:id/simular-sinal', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    const ride = (await query( 
      "SELECT * FROM rides WHERE id = $1 AND tipo = 'agendada' AND sinal_pago = false", 
      [id] 
    )).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Agendamento não encontrado ou sinal já pago' }) 
 
    await query( 
      "UPDATE rides SET sinal_pago = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1", 
      [id] 
    ) 
 
    const io = getIo() 
    if (io) { 
      io.to(`ride:${ride.id}`).emit('agendamento:sinal_confirmado', { 
        rideId: ride.id, 
        sinal_valor: ride.sinal_valor 
      }) 
      // Atualizar badge para todos motoristas 
      const disponiveis = (await query(` 
        SELECT COUNT(*) as total FROM rides 
        WHERE tipo = 'agendada' AND status = 'agendada' 
        AND sinal_pago = true AND driver_id IS NULL AND agendada_para > NOW() AT TIME ZONE 'America/Sao_Paulo' 
      `)).rows[0] 
      io.emit('agendamentos:atualizar', { count: parseInt(disponiveis.total) }) 
    } 

    return { mensagem: 'Sinal simulado com sucesso!', corrida_id: id, sinal_valor: ride.sinal_valor } 
  })

  // Admin: gerar cobrança restante manualmente
  fastify.post('/api/admin/agendamentos/:id/gerar-restante', async (request, reply) => { 
    const ride = (await query('SELECT * FROM rides WHERE id = $1', [request.params.id])).rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
    const resultado = await gerarCobrancaRestante(ride) 
    if (!resultado) return reply.code(400).send({ error: 'Não foi possível gerar cobrança restante' }) 
    return { sucesso: true, ...resultado } 
  })
}
