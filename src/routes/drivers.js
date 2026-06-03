import { v4 as uuidv4 } from 'uuid' 
import { query, pool } from '../db.js' 
import { requireAuth } from '../middleware/auth.js'
import crypto from 'crypto' 
 
export default async function driversRoutes(fastify) {

  fastify.get('/api/temp/check-transactions', async (request, reply) => {
    const tableSchema = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'driver_transactions'
    `)
    const transactions = await query('SELECT * FROM driver_transactions LIMIT 10')
    return {
      table_columns: tableSchema.rows,
      transactions: transactions.rows
    }
  })

  fastify.post('/api/cadastro-geral', async (request, reply) => { 
    const { 
      nome, telefone, email, cpf,
      marca_carro, modelo_carro, ano_carro, cor_carro, placa, renavam,
      crlv_base64, cnh_frente_base64, cnh_verso_base64, cnh_digital_base64, foto_base64,
      tipo_chave_pix, chave_pix, cep, logradouro, numero, complemento, bairro, cidade, estado,
      data_nascimento
    } = request.body 

    if (!nome || !telefone || !cpf || !modelo_carro || !ano_carro || !placa || !renavam || !numero) { 
      return reply.code(400).send({ error: 'Todos os campos obrigatÃ³rios sÃ£o necessÃ¡rios' }) 
    } 

    const temFotosCnh = cnh_frente_base64 && cnh_verso_base64
    const temCnhDigital = cnh_digital_base64
    if (!temFotosCnh && !temCnhDigital) {
      return reply.code(400).send({ error: 'Anexe a CNH (frente e verso OU arquivo digital)' }) 
    }

    try { 
      const result = await query(` 
   INSERT INTO drivers 
     (nome, telefone, email, status_cadastro, ativo, 
      modelo_carro, ano_carro, cor_carro, placa, 
      cpf, renavam, crlv_base64, 
      cnh_frente_base64, cnh_verso_base64, cnh_digital_base64, foto_base64, 
      tipo_chave_pix, chave_pix, cep, logradouro, numero, complemento, bairro, cidade, estado, 
      data_nascimento) 
   VALUES ($1, $2, $3, 'pendente', 0, 
            $4, $5, $6, $7, 
            $8, $9, $10, 
            $11, $12, $13, $14, 
            $15, $16, $17, $18, $19, $20, $21, $22, $23, 
            $24) 
   RETURNING id 
 `, [ 
   nome, telefone, email || null, 
   modelo_carro, ano_carro, cor_carro || 'NÃ£o informado', placa, 
   cpf, renavam, crlv_base64 || null, 
   cnh_frente_base64 || null, cnh_verso_base64 || null, cnh_digital_base64 || null, foto_base64 || null, 
   tipo_chave_pix || null, chave_pix || null, 
   cep || null, logradouro || null, numero || null, complemento || null, bairro || null, cidade || null, estado || null, 
   data_nascimento || null 
 ]) 

      return { id: result.rows[0].id, mensagem: 'Cadastro enviado para aprovaÃ§Ã£o' } 
    } catch (err) { 
      throw err 
    } 
  }) 

  fastify.get('/api/drivers', { preHandler: requireAuth }, async () => { 
    const result = await query(`SELECT id, nome, telefone, email, modelo_carro, ano_carro, cor_carro, placa, 
      total_viagens, media_avaliacao, total_avaliacoes, ativo, foto_base64, token_perfil, created_at, status_cadastro,
      cpf, renavam, crlv_base64, cnh_frente_base64, cnh_verso_base64, cnh_digital_base64,
      tipo_chave_pix, chave_pix, asaas_id, mobihub_id,
      cep, logradouro, numero, complemento, bairro, cidade, estado, data_nascimento
    FROM drivers ORDER BY nome`)
    return result.rows
  }) 
 
  fastify.post('/api/drivers', { preHandler: requireAuth }, async (request, reply) => { 
    const { 
      nome, telefone, 
      modelo_carro, ano_carro, cor_carro, placa, foto_base64 
    } = request.body 

    if (!nome || !telefone || !modelo_carro || !ano_carro || !cor_carro || !placa) { 
      return reply.code(400).send({ error: 'Todos os campos sÃ£o obrigatÃ³rios' }) 
    } 

    try { 
      const result = await query(` 
        INSERT INTO drivers 
          (nome, telefone, modelo_carro, ano_carro, cor_carro, placa, foto_base64) 
        VALUES ($1, $2, $3, $4, $5, $6, $7) 
        RETURNING id
      `, [nome, telefone, modelo_carro, ano_carro, cor_carro, placa, foto_base64 || null]) 

      return { id: result.rows[0].id, mensagem: 'Motorista cadastrado com sucesso' } 
    } catch (err) { 
      throw err 
    } 
  }) 
 
  fastify.delete('/api/drivers/:id', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    const driverResult = await query('SELECT id FROM drivers WHERE id = $1', [id])
    const driver = driverResult.rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 

    await query('UPDATE drivers SET ativo = 0 WHERE id = $1', [id]) 
    return { mensagem: 'Motorista desativado' } 
  }) 

  fastify.post('/api/drivers/:id/gerar-token', { preHandler: requireAuth }, async (request, reply) => { 
    console.log('[GERAR-TOKEN] Chamado com id:', request.params.id) 
    console.log('[GERAR-TOKEN] Headers:', request.headers.authorization ? 'JWT presente' : 'JWT ausente') 
    
    const { id } = request.params 
    const driverResult = await query('SELECT id FROM drivers WHERE id = $1', [id])
    const driver = driverResult.rows[0]
    console.log('[GERAR-TOKEN] Driver encontrado:', driver) 
    
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
    
    try { 
      const { v4: uuidv4 } = await import('uuid') 
      const novoToken = uuidv4() 
      await query('UPDATE drivers SET token_perfil = $1 WHERE id = $2', [novoToken, id]) 
      console.log('[GERAR-TOKEN] Token gerado:', novoToken) 
      return { token_perfil: novoToken, mensagem: 'Token gerado com sucesso' } 
    } catch(err) { 
      console.error('[GERAR-TOKEN] Erro:', err.message) 
      return reply.code(500).send({ error: err.message }) 
    } 
  }) 

  fastify.delete('/api/drivers/:id/excluir', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    const driverResult = await query('SELECT * FROM drivers WHERE id = $1', [id])
    const driver = driverResult.rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
    await query('DELETE FROM driver_transactions WHERE driver_id = $1', [id]) 
    await query('DELETE FROM driver_locations WHERE driver_id = $1', [id]) 
    await query('DELETE FROM ratings WHERE ride_id IN (SELECT id FROM rides WHERE driver_id = $1)', [id]) 
    await query('UPDATE rides SET driver_id = NULL WHERE driver_id = $1', [id]) 
    await query('DELETE FROM drivers WHERE id = $1', [id]) 
    return { mensagem: 'Motorista excluÃ­do com sucesso' } 
  }) 

  // Gerar link de convite para motorista 
  fastify.post('/api/drivers/convite', { preHandler: requireAuth }, async (request, reply) => { 
    const { v4: uuidv4 } = await import('uuid') 
    const token = uuidv4() 
    const expira = new Date() 
    expira.setDate(expira.getDate() + 7) 

    await query(` 
      INSERT INTO convites (token, expira_em, usado) VALUES ($1, $2, false) 
    `, [token, expira.toISOString()]) 

    const link = `${process.env.BASE_URL}/cadastro-motorista/${token}` 
    return { token, link, expira: expira.toISOString() } 
  }) 

  // Listar motoristas pendentes 
  fastify.get('/api/drivers/pendentes', { preHandler: requireAuth }, async () => { 
    console.log('[API] Buscando motoristas pendentes...') 
    const result = await query(` 
      SELECT * FROM drivers WHERE status_cadastro = 'pendente' ORDER BY created_at DESC 
    `) 
    console.log('[API] Motoristas pendentes encontrados:', result.rows.length) 
    console.log('[API] Dados dos motoristas:', result.rows) 
    return result.rows 
  }) 

  // Aprovar motorista 
  fastify.put('/api/drivers/:id/aprovar', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    const driverResult = await query('SELECT * FROM drivers WHERE id = $1', [id]) 
    const driver = driverResult.rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' })

    const { v4: uuidv4 } = await import('uuid')
    const token = driver.token_perfil || uuidv4()
    
    // Gerar mobihub_id se nÃ£o existir
    let mobihubId = driver.mobihub_id
    if (!mobihubId) {
      const lastId = (await query("SELECT mobihub_id FROM drivers WHERE mobihub_id IS NOT NULL ORDER BY mobihub_id DESC LIMIT 1")).rows[0]
      const nextNum = lastId ? parseInt(lastId.mobihub_id.split('-')[2]) + 1 : 1
      mobihubId = `ZH-VIX-${String(nextNum).padStart(4, '0')}`
    }
    
    await query(` 
      UPDATE drivers SET status_cadastro = 'aprovado', ativo = 1, token_perfil = $1, mobihub_id = $2 WHERE id = $3 
    `, [token, mobihubId, id]) 

    // telegram removido

    // Disparar webhook motorista.aprovado para Make
    const { dispararWebhook } = await import('../webhook.js')
    await dispararWebhook('motorista.aprovado', { 
      driver_id: driver.id, 
      nome: driver.nome, 
      status: 'ACTIVE', 
      balance_due: 0, 
      rides_month: 0 
    })

    return { mensagem: 'Motorista aprovado com sucesso' } 
  })

  // Reprovar motorista 
  fastify.put('/api/drivers/:id/reprovar', { preHandler: requireAuth }, async (request, reply) => { 
    const { motivo } = request.body 
    const { id } = request.params 
    await query(` 
      UPDATE drivers SET status_cadastro = 'reprovado', ativo = 0, motivo_reprovacao = $1 WHERE id = $2 
    `, [motivo || null, id]) 

    // telegram removido

    return { mensagem: 'Motorista reprovado' } 
  })

  // Desativar motorista
  fastify.put('/api/drivers/:id/desativar', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params
    await query(`
      UPDATE drivers SET ativo = 0, status_cadastro = 'inativo' WHERE id = $1
    `, [id])
    return { mensagem: 'Motorista desativado' }
  })

  // Ativar motorista
  fastify.put('/api/drivers/:id/ativar', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params
    const driverResult = await query('SELECT * FROM drivers WHERE id = $1', [id])
    const driver = driverResult.rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' })
    
    const { v4: uuidv4 } = await import('uuid')
    const token = driver.token_perfil || uuidv4()
    
    // Gerar mobihub_id se nÃ£o existir
    let mobihubId = driver.mobihub_id
    if (!mobihubId) {
      const lastId = (await query("SELECT mobihub_id FROM drivers WHERE mobihub_id IS NOT NULL ORDER BY mobihub_id DESC LIMIT 1")).rows[0]
      const nextNum = lastId ? parseInt(lastId.mobihub_id.split('-')[2]) + 1 : 1
      mobihubId = `ZH-VIX-${String(nextNum).padStart(4, '0')}`
    }
    
    await query(`
      UPDATE drivers SET 
        ativo = 1, 
        status_cadastro = 'aprovado', 
        token_perfil = $1, 
        mobihub_id = $2,
        aceitou_termos = false,
        versao_termos = null,
        data_aceite_termos = null,
        ip_aceite_termos = null,
        hash_aceite_termos = null
      WHERE id = $3
    `, [token, mobihubId, id])



    // Disparar webhook motorista.aprovado
    const { dispararWebhook } = await import('../webhook.js')
    await dispararWebhook('motorista.aprovado', { 
      driver_id: driver.id, 
      nome: driver.nome, 
      status: 'ACTIVE', 
      balance_due: parseFloat(driver.balance_due || 0), 
      rides_month: 0 
    })

    return { mensagem: 'Motorista ativado' }
  })

  fastify.put('/api/drivers/:id', { preHandler: requireAuth }, async (request, reply) => { 
    const { nome, telefone, email, modelo_carro, ano_carro, cor_carro, placa, ativo, foto_base64, status_cadastro, tipo_chave_pix, chave_pix, asaas_id, cep, logradouro, numero, complemento, bairro, cidade, estado, cpf, renavam, data_nascimento } = request.body 
    const { id } = request.params 

    const driverResult = await query('SELECT id, status_cadastro FROM drivers WHERE id = $1', [id])
    const driver = driverResult.rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 

    let novoAtivo = ativo
    const novoStatus = status_cadastro || driver.status_cadastro

    if (novoStatus === 'aprovado') {
      novoAtivo = 1
    } else if (novoStatus === 'reprovado' || novoStatus === 'pendente') {
      novoAtivo = 0
    }

    await query(` 
      UPDATE drivers SET 
        nome = COALESCE($1, nome), 
        telefone = COALESCE($2, telefone), 
        email = COALESCE($3, email),
        modelo_carro = COALESCE($4, modelo_carro), 
        ano_carro = COALESCE($5, ano_carro), 
        cor_carro = COALESCE($6, cor_carro), 
        placa = COALESCE($7, placa), 
        ativo = $8, 
        foto_base64 = COALESCE($9, foto_base64),
        status_cadastro = COALESCE($10, status_cadastro),
        tipo_chave_pix = COALESCE($11, tipo_chave_pix),
        chave_pix = COALESCE($12, chave_pix),
        asaas_id = COALESCE($13, asaas_id),
        cep = COALESCE($14, cep),
        logradouro = COALESCE($15, logradouro),
        numero = COALESCE($16, numero),
        complemento = COALESCE($17, complemento),
        bairro = COALESCE($18, bairro),
        cidade = COALESCE($19, cidade),
        estado = COALESCE($20, estado),
        cpf = COALESCE($21, cpf),
        renavam = COALESCE($22, renavam),
        data_nascimento = COALESCE($23, data_nascimento)
      WHERE id = $24 
    `, [nome, telefone, email, modelo_carro, ano_carro, cor_carro, placa, novoAtivo, foto_base64, novoStatus, tipo_chave_pix, chave_pix, asaas_id, cep, logradouro, numero, complemento, bairro, cidade, estado, cpf, renavam, data_nascimento, id]) 

    return { mensagem: 'Motorista atualizado' } 
  }) 

  fastify.post('/api/admin/drivers/:id/limpar-pagamentos', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    const result = await query( 
      "UPDATE rides SET pagamento_status = 'cancelado' WHERE driver_id = $1 AND pagamento_status = 'aguardando_pagamento'", 
      [id] 
    ) 
    return { mensagem: 'Pagamentos pendentes cancelados', rows_affected: result.rowCount } 
  })

  fastify.post('/api/admin/drivers/:id/simular-pagamento', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    const rideResult = await query( 
      "SELECT * FROM rides WHERE driver_id = $1 AND pagamento_status = 'aguardando_pagamento' ORDER BY id DESC LIMIT 1", 
      [id] 
    ) 
    const ride = rideResult.rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Nenhuma corrida aguardando pagamento' }) 
    
    await query("UPDATE rides SET pagamento_status = 'pago', status = 'concluida', concluida_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [ride.id]) 
    
    return { mensagem: 'Pagamento simulado com sucesso', corrida_id: ride.id } 
  })

  fastify.post('/api/admin/drivers/:id/resetar-corrida', { preHandler: requireAuth, config: { rawBody: false } }, async (request, reply) => { 
    const { id } = request.params 
    const result = await query( 
      `SELECT id, status, pagamento_status FROM rides WHERE driver_id = $1 ORDER BY id DESC LIMIT 1`, 
      [id] 
    ) 
    const ride = result.rows[0] 
    if (!ride) return reply.code(404).send({ error: 'Nenhuma corrida encontrada' }) 
    
    await query( 
      `UPDATE rides SET status = 'concluida', pagamento_status = 'pago', concluida_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, 
      [ride.id] 
    ) 
    return { ok: true, mensagem: 'Corrida resetada', corrida_id: ride.id, status_anterior: ride.status, pagamento_anterior: ride.pagamento_status } 
  })

  fastify.post('/api/admin/drivers/:id/zerar-saldo', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    const driverResult = await query('SELECT balance_due FROM drivers WHERE id = $1', [id]) 
    const saldoAtual = parseFloat(driverResult.rows[0]?.balance_due || 0) 

    await query('UPDATE drivers SET balance_due = 0, balance_due_blocked_at = NULL, balance_due_charge_id = NULL, balance_due_charge_pix = NULL WHERE id = $1', [id]) 

    if (saldoAtual > 0) { 
      await query( 
        'INSERT INTO driver_transactions (driver_id, tipo, descricao, valor) VALUES ($1, $2, $3, $4)', 
        [id, 'credito', 'Saldo devedor zerado pelo admin', saldoAtual] 
      ) 
    }

    return { mensagem: 'Saldo devedor zerado com sucesso!' } 
  }) 



  // Aceitar termos de uso e LGPD
  fastify.post('/api/motorista/aceitar-termos', async (request, reply) => { 
    try { 
      const { token, aceite_arbitragem } = request.body; 
      console.log('[DEBUG] Token recebido:', token); 
      if (!token) return reply.code(400).send({ error: 'Token ausente no body' }); 

      const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip
      const versaoTermos = '2.1'

      const motoristaResult = await query('SELECT * FROM drivers WHERE token_perfil = $1', [token])
      const motorista = motoristaResult.rows[0]
      if (!motorista) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' })

      const termoResult = await query('SELECT * FROM termos_versoes WHERE versao = $1', [versaoTermos])
      const termo = termoResult.rows[0]
      const textoTermo = termo?.conteudo || ''

      const dadosHash = `${motorista.nome || ''}|${motorista.cpf || ''}|${motorista.telefone || ''}|${ip}|${new Date().toISOString()}|${versaoTermos}|${textoTermo}`
      const hash = crypto.createHash('sha256').update(dadosHash).digest('hex')

      const result = await query(` 
        UPDATE drivers 
        SET aceitou_termos = true, 
            data_aceite_termos = CURRENT_TIMESTAMP, 
            ip_aceite_termos = $1, 
            versao_termos = '2.1', 
            aceite_arbitragem = $2,
            hash_aceite_termos = $3
        WHERE token_perfil = $4 
      `, [ip, aceite_arbitragem ? true : false, hash, token]); 

      console.log('[ACEITE TERMOS] Token:', token, '| Rows updated:', result.rowCount);

      return { success: true }; 
    } catch (err) { 
      console.error('[ERRO ACEITE]:', err); 
      return reply.code(500).send({ error: err.message }); 
    } 
  });

  // Atualizar status online/offline 
  fastify.put('/api/motorista/:token/online', async (request, reply) => { 
    const { online } = request.body 
    const driverResult = await query('SELECT id, aceitou_termos FROM drivers WHERE token_perfil = $1', [request.params.token]) 
    const driver = driverResult.rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
    
    if (online && !driver.aceitou_termos) {
      return reply.code(400).send({ error: 'Aceite os termos primeiro' })
    }

    await query(` 
       UPDATE drivers SET 
         online = $1, 
         online_desde = CASE WHEN $1 = 1 THEN CURRENT_TIMESTAMP ELSE NULL END 
       WHERE id = $2 
     `, [online ? 1 : 0, driver.id]) 
   
    return { mensagem: online ? 'VocÃª estÃ¡ online' : 'VocÃª estÃ¡ offline', online } 
  }) 
 
  // Atualizar perfil do motorista
  fastify.put('/api/drivers/perfil', async (request, reply) => {
    const { token_perfil, data_nascimento, tipo_chave_pix, chave_pix, cep, logradouro, numero, complemento, bairro, cidade, estado } = request.body
    if (!token_perfil) return reply.code(400).send({ error: 'Token do motorista ausente' })

    const driverResult = await query('SELECT id FROM drivers WHERE token_perfil = $1', [token_perfil])
    const driver = driverResult.rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' })

    await query(`
      UPDATE drivers SET
        data_nascimento = COALESCE($1, data_nascimento),
        tipo_chave_pix = COALESCE($2, tipo_chave_pix),
        chave_pix = COALESCE($3, chave_pix),
        cep = COALESCE($4, cep),
        logradouro = COALESCE($5, logradouro),
        numero = COALESCE($6, numero),
        complemento = COALESCE($7, complemento),
        bairro = COALESCE($8, bairro),
        cidade = COALESCE($9, cidade),
        estado = COALESCE($10, estado)
      WHERE id = $11
    `, [data_nascimento || null, tipo_chave_pix || null, chave_pix || null, cep || null, logradouro || null, numero || null, complemento || null, bairro || null, cidade || null, estado || null, driver.id])

    return { mensagem: 'Dados atualizados com sucesso' }
  })

  // Listar veÃ­culos do motorista 
  fastify.get('/api/motorista/:token/veiculos', async (request, reply) => { 
    const driver = (await query( 
      'SELECT id FROM drivers WHERE token_perfil = $1', 
      [request.params.token] 
    )).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 

    const veiculos = (await query( 
      'SELECT * FROM vehicles WHERE driver_id = $1 ORDER BY ativo DESC, created_at ASC', 
      [driver.id] 
    )).rows 

    return veiculos 
  }) 
 
  // Adicionar veÃ­culo 
  fastify.post('/api/motorista/:token/veiculos', async (request, reply) => { 
    const { modelo, ano, cor, placa } = request.body 
    if (!modelo || !ano || !cor || !placa) { 
      return reply.code(400).send({ error: 'Todos os campos sÃ£o obrigatÃ³rios' }) 
    } 
 
    const driver = (await query( 
      'SELECT id FROM drivers WHERE token_perfil = $1', 
      [request.params.token] 
    )).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
 
    // Verifica se placa jÃ¡ existe 
    const existing = (await query( 
      'SELECT id FROM vehicles WHERE placa = $1', 
      [placa.toUpperCase()] 
    )).rows[0] 
    if (existing) return reply.code(409).send({ error: 'Placa jÃ¡ cadastrada' }) 
 
    // Conta quantos veÃ­culos o motorista tem 
    const total = (await query( 
      'SELECT COUNT(*) as total FROM vehicles WHERE driver_id = $1', 
      [driver.id] 
    )).rows[0] 
 
    // Primeiro veÃ­culo Ã© automaticamente ativo 
    const primeiroVeiculo = parseInt(total.total) === 0 
 
    const result = await query(` 
      INSERT INTO vehicles (driver_id, modelo, ano, cor, placa, ativo) 
      VALUES ($1, $2, $3, $4, $5, $6) 
      RETURNING * 
    `, [driver.id, modelo, ano, cor.toLowerCase(), placa.toUpperCase(), primeiroVeiculo ? 1 : 0]) 
 
    // Se for o primeiro, atualiza tambÃ©m o driver 
    if (primeiroVeiculo) { 
      await query(` 
        UPDATE drivers SET modelo_carro = $1, ano_carro = $2, cor_carro = $3, placa = $4 WHERE id = $5 
      `, [modelo, ano, cor, placa.toUpperCase(), driver.id]) 
    } 
 
    return { mensagem: 'VeÃ­culo cadastrado!', veiculo: result.rows[0] } 
  }) 
 
  // Selecionar veÃ­culo ativo 
  fastify.put('/api/motorista/:token/veiculos/:vehicleId/ativar', async (request, reply) => { 
    const { token, vehicleId } = request.params 
 
    const driver = (await query( 
      'SELECT id, online FROM drivers WHERE token_perfil = $1', 
      [token] 
    )).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
 
    // Verifica se tem corrida em andamento 
    const corridaAtiva = (await query( 
      "SELECT id FROM rides WHERE driver_id = $1 AND status = 'aceita'", 
      [driver.id] 
    )).rows[0] 
    if (corridaAtiva) { 
      return reply.code(400).send({ error: 'NÃ£o Ã© possÃ­vel trocar de veÃ­culo com corrida em andamento' }) 
    } 
 
    // Verifica se o veÃ­culo pertence ao motorista 
    const veiculo = (await query( 
      'SELECT * FROM vehicles WHERE id = $1 AND driver_id = $2', 
      [vehicleId, driver.id] 
    )).rows[0] 
    if (!veiculo) return reply.code(404).send({ error: 'VeÃ­culo nÃ£o encontrado' }) 
 
    // Desativa todos os veÃ­culos do motorista 
    await query('UPDATE vehicles SET ativo = 0 WHERE driver_id = $1', [driver.id]) 
 
    // Ativa o selecionado 
    await query('UPDATE vehicles SET ativo = 1 WHERE id = $1', [vehicleId]) 
 
    // Atualiza dados do motorista com o veÃ­culo ativo 
    await query(` 
      UPDATE drivers SET 
        modelo_carro = $1, 
        ano_carro = $2, 
        cor_carro = $3, 
        placa = $4 
      WHERE id = $5 
    `, [veiculo.modelo, veiculo.ano, veiculo.cor, veiculo.placa, driver.id]) 
 
    return { mensagem: `VeÃ­culo ${veiculo.modelo} ${veiculo.placa} ativado!` } 
  }) 
 
  // Remover veÃ­culo 
  fastify.delete('/api/motorista/:token/veiculos/:vehicleId', async (request, reply) => { 
    const { token, vehicleId } = request.params 
 
    const driver = (await query( 
      'SELECT id FROM drivers WHERE token_perfil = $1', 
      [token] 
    )).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' }) 
 
    const veiculo = (await query( 
      'SELECT * FROM vehicles WHERE id = $1 AND driver_id = $2', 
      [vehicleId, driver.id] 
    )).rows[0] 
    if (!veiculo) return reply.code(404).send({ error: 'VeÃ­culo nÃ£o encontrado' }) 
 
    if (veiculo.ativo) { 
      return reply.code(400).send({ error: 'NÃ£o Ã© possÃ­vel remover o veÃ­culo ativo. Ative outro primeiro.' }) 
    } 
 
    // Verifica se tem apenas 1 veÃ­culo 
    const total = (await query( 
      'SELECT COUNT(*) as total FROM vehicles WHERE driver_id = $1', 
      [driver.id] 
    )).rows[0] 
    if (parseInt(total.total) <= 1) { 
      return reply.code(400).send({ error: 'VocÃª precisa ter pelo menos 1 veÃ­culo cadastrado' }) 
    } 
 
    await query('DELETE FROM vehicles WHERE id = $1', [vehicleId]) 
    return { mensagem: 'VeÃ­culo removido' } 
  }) 
 
  // Rota admin â€” adicionar veÃ­culo para motorista 
  fastify.post('/api/drivers/:id/veiculos', { preHandler: requireAuth }, async (request, reply) => { 
    const { modelo, ano, cor, placa } = request.body 
    const { id } = request.params 
 
    if (!modelo || !ano || !cor || !placa) { 
      return reply.code(400).send({ error: 'Todos os campos sÃ£o obrigatÃ³rios' }) 
    } 
 
    const existing = (await query('SELECT id FROM vehicles WHERE placa = $1', [placa.toUpperCase()])).rows[0] 
    if (existing) return reply.code(409).send({ error: 'Placa jÃ¡ cadastrada' }) 
 
    const total = (await query('SELECT COUNT(*) as total FROM vehicles WHERE driver_id = $1', [id])).rows[0] 
    const primeiroVeiculo = parseInt(total.total) === 0 
 
    const result = await query(` 
      INSERT INTO vehicles (driver_id, modelo, ano, cor, placa, ativo) 
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING * 
    `, [id, modelo, ano, cor, placa.toUpperCase(), primeiroVeiculo ? 1 : 0]) 
 
    if (primeiroVeiculo) { 
      await query(` 
        UPDATE drivers SET modelo_carro = $1, ano_carro = $2, cor_carro = $3, placa = $4 WHERE id = $5 
      `, [modelo, ano, cor, placa.toUpperCase(), id]) 
    } 
 
    return { mensagem: 'VeÃ­culo cadastrado!', veiculo: result.rows[0] } 
  }) 

  // Extrato financeiro do motorista (admin)
  fastify.get('/api/admin/drivers/:id/extrato', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params
    const driver = (await query('SELECT id FROM drivers WHERE id = $1', [id])).rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista nÃ£o encontrado' })
    
    const transactions = (await query(
      'SELECT * FROM driver_transactions WHERE driver_id = $1 ORDER BY created_at ASC',
      [id]
    )).rows

    let saldoAcumulado = 0
    const transactionsWithBalance = transactions.map(t => {
      saldoAcumulado += t.valor
      return { ...t, saldo_acumulado: saldoAcumulado }
    })

    return { transactions: transactionsWithBalance, saldo_final: saldoAcumulado }
  })

  fastify.put('/api/admin/drivers/:id/toggle', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params
    const { ativo } = request.body
    await query('UPDATE drivers SET ativo = $1 WHERE id = $2', [ativo, id])
    return { mensagem: 'Status atualizado' }
  })

  fastify.post('/api/admin/drivers/:id/pagar-saldo', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    await query('UPDATE drivers SET balance_due = 0 WHERE id = $1', [id]) 
    return { ok: true, message: 'Saldo zerado com sucesso' } 
  })

  fastify.get('/api/admin/motoristas/realtime', { preHandler: requireAuth }, async (request, reply) => { 
    const { de, ate } = request.query
    const hoje = new Date().toISOString().split('T')[0]
    const dataDe = de || hoje
    const dataAte = ate || hoje
    
    // 1. Buscar motoristas base (mesmo query original, sÃ³ com date params nas subqueries)
    const result = await query(` 
      SELECT 
        d.id, d.nome, d.modelo_carro, d.cor_carro, d.placa, d.telefone,
        d.online, d.ativo, d.status_cadastro, d.token_perfil, 
        d.media_avaliacao, d.total_viagens, d.total_avaliacoes, 
        d.balance_due, 
        dl.lat AS ultima_lat, dl.lng AS ultima_lng, dl.updated_at as location_at, 
        r.id as corrida_id, r.status as corrida_status, 
        r.origem, r.destino, r.valor, r.origem_lat, r.origem_lng, r.destino_lat, r.destino_lng,
        r.aceita_at, r.created_at as corrida_criada_at, 
        c.nome as passageiro_nome, 
        EXTRACT(EPOCH FROM (NOW() - dl.updated_at)) as segundos_sem_update, 
        (SELECT COUNT(*) FROM rides r2 WHERE r2.driver_id = d.id AND r2.status = 'concluida' AND DATE(r2.concluida_at) BETWEEN $1 AND $2) as corridas_hoje, 
        (SELECT COALESCE(SUM(r2.valor_motorista), 0) FROM rides r2 WHERE r2.driver_id = d.id AND r2.status = 'concluida' AND DATE(r2.concluida_at) BETWEEN $1 AND $2) as ganhos_hoje 
      FROM drivers d 
      LEFT JOIN LATERAL ( 
        SELECT lat, lng, updated_at FROM driver_locations 
        WHERE driver_id = d.id ORDER BY updated_at DESC LIMIT 1 
      ) dl ON true 
      LEFT JOIN rides r ON r.driver_id = d.id AND r.status IN ('aceita', 'em_viagem', 'aberta') 
      LEFT JOIN clients c ON r.client_id = c.id 
      WHERE d.status_cadastro IN ('aprovado', 'pendente', 'reprovado') 
      ORDER BY d.online DESC, d.nome ASC 
    `, [dataDe, dataAte]) 
    
    const drivers = result.rows
    
    // 2. Adicionar corrida_atual para cada motorista
    // 3. Adicionar corridas_agendadas para cada motorista
    const driverIds = drivers.map(d => d.id)
    let corridasAgendadas = []
    if (driverIds.length > 0) {
      const agendadasResult = await query(`
        SELECT id, driver_id, agendada_para, origem, destino, valor
        FROM rides
        WHERE status = 'agendada' AND driver_id = ANY($1)
        ORDER BY agendada_para ASC
      `, [driverIds])
      corridasAgendadas = agendadasResult.rows
    }
    
    // Montar o retorno final
    const finalDrivers = drivers.map(d => {
      const agendadas = corridasAgendadas.filter(a => a.driver_id === d.id)
      let corridaAtual = null
      
      if (d.corrida_id && ['aceita','em_viagem','aberta'].includes(d.corrida_status)) {
        corridaAtual = {
          id: d.corrida_id,
          origem: d.origem,
          destino: d.destino,
          origem_lat: d.origem_lat,
          origem_lng: d.origem_lng,
          destino_lat: d.destino_lat,
          destino_lng: d.destino_lng,
          valor: d.valor
        }
      }
      
      return {
        ...d,
        corrida_atual: corridaAtual,
        corridas_agendadas: agendadas
      }
    })
    
    return finalDrivers 
  })

  // Rota pÃºblica: app motorista consulta status e token pelo CPF
  fastify.get('/api/motorista/status-cadastro', async (request, reply) => {
    const { cpf } = request.query
    if (!cpf) {
      return reply.code(400).send({ error: 'CPF obrigatÃ³rio' })
    }
    try {
      const cpfLimpo = cpf.replace(/\D/g, '')
      const result = await query(
        `SELECT status_cadastro, token_perfil, ativo FROM drivers
         WHERE regexp_replace(cpf, '[^0-9]', '', 'g') = $1`,
        [cpfLimpo]
      )
      if (result.rows.length === 0) {
        return reply.send({ status: 'nao_encontrado', token: null })
      }
      const driver = result.rows[0]
      return reply.send({
        status: driver.status_cadastro,
        token: driver.ativo === 1 || driver.ativo === true ? driver.token_perfil : null
      })
    } catch (err) {
      return reply.code(500).send({ error: 'Erro ao consultar status' })
    }
  })
}

