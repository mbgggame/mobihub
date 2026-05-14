import { v4 as uuidv4 } from 'uuid' 
import { query, pool } from '../db.js' 
import { requireAuth } from '../middleware/auth.js' 
 
export default async function driversRoutes(fastify) { 

  fastify.post('/api/cadastro-geral', async (request, reply) => { 
    const { 
      nome, telefone, telegram_id, email, cpf,
      marca_carro, modelo_carro, ano_carro, cor_carro, placa, renavam,
      crlv_base64, cnh_frente_base64, cnh_verso_base64, cnh_digital_base64, foto_base64,
      tipo_chave_pix, chave_pix, cep, logradouro, numero, complemento, bairro, cidade, estado
    } = request.body 

    if (!nome || !telefone || !cpf || !modelo_carro || !ano_carro || !placa || !renavam || !numero) { 
      return reply.code(400).send({ error: 'Todos os campos obrigatórios são necessários' }) 
    } 

    const temFotosCnh = cnh_frente_base64 && cnh_verso_base64
    const temCnhDigital = cnh_digital_base64
    if (!temFotosCnh && !temCnhDigital) {
      return reply.code(400).send({ error: 'Anexe a CNH (frente e verso OU arquivo digital)' }) 
    }

    try { 
      // Verifica se já existe motorista com esse telegram_id
      if (telegram_id && telegram_id !== '0') {
        const check = await query('SELECT id FROM drivers WHERE telegram_id = $1', [telegram_id])
        if (check.rows.length > 0) {
          return reply.code(409).send({ error: 'Telegram ID já cadastrado como motorista' }) 
        }
      }

      const result = await query(` 
        INSERT INTO drivers 
          (nome, telefone, email, telegram_id, status_cadastro, ativo, 
           modelo_carro, ano_carro, cor_carro, placa, 
           cpf, renavam, crlv_base64, 
           cnh_frente_base64, cnh_verso_base64, cnh_digital_base64, foto_base64,
           tipo_chave_pix, chave_pix, cep, logradouro, numero, complemento, bairro, cidade, estado) 
        VALUES ($1, $2, $3, $4, 'pendente', 0, 
                 $5, $6, $7, $8, 
                 $9, $10, $11,
                 $12, $13, $14, $15, $16, $17, $18,
                 $19, $20, $21, $22, $23, $24, $25)
        RETURNING id
      `, [
        nome, telefone, email || null, telegram_id || '0', 
        modelo_carro, ano_carro, cor_carro || 'Não informado', placa,
        cpf, renavam, crlv_base64 || null,
        cnh_frente_base64 || null, cnh_verso_base64 || null, cnh_digital_base64 || null, foto_base64 || null,
        tipo_chave_pix || null, chave_pix || null,
        cep || null, logradouro || null, numero, complemento || null, bairro || null, cidade || null, estado || null
      ]) 

      return { id: result.rows[0].id, mensagem: 'Cadastro enviado para aprovação' } 
    } catch (err) { 
      if (err.message.includes('unique') || err.message.includes('UNIQUE')) { 
        return reply.code(409).send({ error: 'Telegram ID já cadastrado como motorista' }) 
      } 
      throw err 
    } 
  }) 

  fastify.get('/api/drivers', { preHandler: requireAuth }, async () => { 
    const result = await query(`SELECT id, nome, telefone, email, telegram_id, modelo_carro, ano_carro, cor_carro, placa, 
      total_viagens, media_avaliacao, total_avaliacoes, ativo, foto_base64, token_perfil, created_at, status_cadastro,
      cpf, renavam, crlv_base64, cnh_frente_base64, cnh_verso_base64, cnh_digital_base64,
      tipo_chave_pix, chave_pix, asaas_id,
      cep, logradouro, numero, complemento, bairro, cidade, estado
    FROM drivers ORDER BY nome`)
    return result.rows
  }) 
 
  fastify.post('/api/drivers', { preHandler: requireAuth }, async (request, reply) => { 
    const { 
      nome, telefone, telegram_id, 
      modelo_carro, ano_carro, cor_carro, placa, foto_base64 
    } = request.body 

    if (!nome || !telegram_id || !modelo_carro || !ano_carro || !cor_carro || !placa) { 
      return reply.code(400).send({ error: 'Todos os campos são obrigatórios' }) 
    } 

    try { 
      // Verifica se já existe motorista com esse telegram_id
      const check = await query('SELECT id FROM drivers WHERE telegram_id = $1', [telegram_id])
      if (check.rows.length > 0) {
        return reply.code(409).send({ error: 'Telegram ID já cadastrado como motorista' }) 
      }

      const result = await query(` 
        INSERT INTO drivers 
          (nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, foto_base64) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
        RETURNING id
      `, [nome, telefone, telegram_id, modelo_carro, ano_carro, cor_carro, placa, foto_base64 || null]) 

      return { id: result.rows[0].id, mensagem: 'Motorista cadastrado com sucesso' } 
    } catch (err) { 
      if (err.message.includes('unique') || err.message.includes('UNIQUE')) { 
        return reply.code(409).send({ error: 'Telegram ID já cadastrado como motorista' }) 
      } 
      throw err 
    } 
  }) 
 
  fastify.delete('/api/drivers/:id', { preHandler: requireAuth }, async (request, reply) => { 
    const { id } = request.params 
    const driverResult = await query('SELECT id FROM drivers WHERE id = $1', [id])
    const driver = driverResult.rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 

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
    
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
    
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
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
    await query('DELETE FROM driver_locations WHERE driver_id = $1', [id]) 
    await query('DELETE FROM ratings WHERE ride_id IN (SELECT id FROM rides WHERE driver_id = $1)', [id]) 
    await query('UPDATE rides SET driver_id = NULL WHERE driver_id = $1', [id]) 
    await query('DELETE FROM drivers WHERE id = $1', [id]) 
    return { mensagem: 'Motorista excluído com sucesso' } 
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
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' })

    const { v4: uuidv4 } = await import('uuid')
    const token = driver.token_perfil || uuidv4()
    
    await query(` 
      UPDATE drivers SET status_cadastro = 'aprovado', ativo = 1, token_perfil = $1 WHERE id = $2 
    `, [token, id]) 

    // Notifica motorista via Telegram 
    if (driver?.telegram_id) { 
      const { getBot } = await import('../telegram.js') 
      const bot = getBot() 
      const linkPerfil = `${process.env.BASE_URL}/motorista/${token}` 
      bot?.sendMessage(driver.telegram_id, 
        `✅ Seu cadastro foi *aprovado!*\n\nBem-vindo ao MobiHub!\n\n👤 Acesse seu painel:\n${linkPerfil}`, 
        { parse_mode: 'Markdown' } 
      ).catch(() => {}) 
    } 

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

    const driverResult = await query('SELECT * FROM drivers WHERE id = $1', [id]) 
    const driver = driverResult.rows[0]
    if (driver?.telegram_id) { 
      const { getBot } = await import('../telegram.js') 
      const bot = getBot() 
      bot?.sendMessage(driver.telegram_id, 
        `❌ Seu cadastro não foi aprovado.\n${motivo ? `\nMotivo: ${motivo}` : ''}`, 
        { parse_mode: 'Markdown' } 
      ).catch(() => {}) 
    } 

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
    const { v4: uuidv4 } = await import('uuid')
    const token = uuidv4()
    
    await query(`
      UPDATE drivers SET ativo = 1, status_cadastro = 'aprovado', token_perfil = $1 WHERE id = $2
    `, [token, id])

    const driverResult = await query('SELECT * FROM drivers WHERE id = $1', [id])
    const driver = driverResult.rows[0]

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
    console.log('[DEBUG] PUT /api/drivers/:id chamado, id:', request.params.id) 
    console.log('[DEBUG] Body recebido:', request.body) 
    const { nome, telefone, email, telegram_id, modelo_carro, ano_carro, cor_carro, placa, ativo, foto_base64, status_cadastro, tipo_chave_pix, chave_pix, asaas_id, cep, logradouro, numero, complemento, bairro, cidade, estado, cpf, renavam } = request.body 
    const { id } = request.params 

    const driverResult = await query('SELECT id, status_cadastro FROM drivers WHERE id = $1', [id])
    const driver = driverResult.rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 

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
        telegram_id = COALESCE($4, telegram_id),
        modelo_carro = COALESCE($5, modelo_carro), 
        ano_carro = COALESCE($6, ano_carro), 
        cor_carro = COALESCE($7, cor_carro), 
        placa = COALESCE($8, placa), 
        ativo = $9, 
        foto_base64 = COALESCE($10, foto_base64),
        status_cadastro = COALESCE($11, status_cadastro),
        tipo_chave_pix = COALESCE($12, tipo_chave_pix),
        chave_pix = COALESCE($13, chave_pix),
        asaas_id = COALESCE($14, asaas_id),
        cep = COALESCE($15, cep),
        logradouro = COALESCE($16, logradouro),
        numero = COALESCE($17, numero),
        complemento = COALESCE($18, complemento),
        bairro = COALESCE($19, bairro),
        cidade = COALESCE($20, cidade),
        estado = COALESCE($21, estado),
        cpf = COALESCE($22, cpf),
        renavam = COALESCE($23, renavam)
      WHERE id = $24 
    `, [nome, telefone, email, telegram_id, modelo_carro, ano_carro, cor_carro, placa, novoAtivo, foto_base64, novoStatus, tipo_chave_pix, chave_pix, asaas_id, cep, logradouro, numero, complemento, bairro, cidade, estado, cpf, renavam, id]) 

    return { mensagem: 'Motorista atualizado' } 
  }) 
 


  // Aceitar termos de uso e LGPD
  fastify.post('/api/motorista/aceitar-termos', async (request, reply) => { 
    try { 
      const { token } = request.body; 
      console.log('[DEBUG] Token recebido:', token); 
      if (!token) return reply.code(400).send({ error: 'Token ausente no body' }); 
 
      await query(` 
        UPDATE drivers 
        SET aceitou_termos = true, 
            data_aceite_termos = CURRENT_TIMESTAMP, 
            ip_aceite_termos = $1, 
            versao_termos = '1.2' 
        WHERE token_perfil = $2 OR telegram_id = $2 
      `, [request.ip, token]); 
 
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
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
    
    if (online && !driver.aceitou_termos) {
      return reply.code(400).send({ error: 'Aceite os termos primeiro' })
    }

    await query(` 
       UPDATE drivers SET 
         online = $1, 
         online_desde = CASE WHEN $1 = 1 THEN CURRENT_TIMESTAMP ELSE NULL END 
       WHERE id = $2 
     `, [online ? 1 : 0, driver.id]) 
   
    return { mensagem: online ? 'Você está online' : 'Você está offline', online } 
  }) 
 
  // Atualizar perfil do motorista
  fastify.put('/api/drivers/perfil', async (request, reply) => {
    const { token_perfil, tipo_chave_pix, chave_pix, cep, logradouro, numero, complemento, bairro, cidade, estado } = request.body
    if (!token_perfil) return reply.code(400).send({ error: 'Token do motorista ausente' })

    const driverResult = await query('SELECT id FROM drivers WHERE token_perfil = $1', [token_perfil])
    const driver = driverResult.rows[0]
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' })

    await query(`
      UPDATE drivers SET
        tipo_chave_pix = COALESCE($1, tipo_chave_pix),
        chave_pix = COALESCE($2, chave_pix),
        cep = COALESCE($3, cep),
        logradouro = COALESCE($4, logradouro),
        numero = COALESCE($5, numero),
        complemento = COALESCE($6, complemento),
        bairro = COALESCE($7, bairro),
        cidade = COALESCE($8, cidade),
        estado = COALESCE($9, estado)
      WHERE id = $10
    `, [tipo_chave_pix || null, chave_pix || null, cep || null, logradouro || null, numero || null, complemento || null, bairro || null, cidade || null, estado || null, driver.id])

    return { mensagem: 'Dados atualizados com sucesso' }
  })

  // Listar veículos do motorista 
  fastify.get('/api/motorista/:token/veiculos', async (request, reply) => { 
    const driver = (await query( 
      'SELECT id FROM drivers WHERE token_perfil = $1', 
      [request.params.token] 
    )).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 

    const veiculos = (await query( 
      'SELECT * FROM vehicles WHERE driver_id = $1 ORDER BY ativo DESC, created_at ASC', 
      [driver.id] 
    )).rows 

    return veiculos 
  }) 
 
  // Adicionar veículo 
  fastify.post('/api/motorista/:token/veiculos', async (request, reply) => { 
    const { modelo, ano, cor, placa } = request.body 
    if (!modelo || !ano || !cor || !placa) { 
      return reply.code(400).send({ error: 'Todos os campos são obrigatórios' }) 
    } 
 
    const driver = (await query( 
      'SELECT id FROM drivers WHERE token_perfil = $1', 
      [request.params.token] 
    )).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    // Verifica se placa já existe 
    const existing = (await query( 
      'SELECT id FROM vehicles WHERE placa = $1', 
      [placa.toUpperCase()] 
    )).rows[0] 
    if (existing) return reply.code(409).send({ error: 'Placa já cadastrada' }) 
 
    // Conta quantos veículos o motorista tem 
    const total = (await query( 
      'SELECT COUNT(*) as total FROM vehicles WHERE driver_id = $1', 
      [driver.id] 
    )).rows[0] 
 
    // Primeiro veículo é automaticamente ativo 
    const primeiroVeiculo = parseInt(total.total) === 0 
 
    const result = await query(` 
      INSERT INTO vehicles (driver_id, modelo, ano, cor, placa, ativo) 
      VALUES ($1, $2, $3, $4, $5, $6) 
      RETURNING * 
    `, [driver.id, modelo, ano, cor.toLowerCase(), placa.toUpperCase(), primeiroVeiculo ? 1 : 0]) 
 
    // Se for o primeiro, atualiza também o driver 
    if (primeiroVeiculo) { 
      await query(` 
        UPDATE drivers SET modelo_carro = $1, ano_carro = $2, cor_carro = $3, placa = $4 WHERE id = $5 
      `, [modelo, ano, cor, placa.toUpperCase(), driver.id]) 
    } 
 
    return { mensagem: 'Veículo cadastrado!', veiculo: result.rows[0] } 
  }) 
 
  // Selecionar veículo ativo 
  fastify.put('/api/motorista/:token/veiculos/:vehicleId/ativar', async (request, reply) => { 
    const { token, vehicleId } = request.params 
 
    const driver = (await query( 
      'SELECT id, online FROM drivers WHERE token_perfil = $1', 
      [token] 
    )).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    // Verifica se tem corrida em andamento 
    const corridaAtiva = (await query( 
      "SELECT id FROM rides WHERE driver_id = $1 AND status = 'aceita'", 
      [driver.id] 
    )).rows[0] 
    if (corridaAtiva) { 
      return reply.code(400).send({ error: 'Não é possível trocar de veículo com corrida em andamento' }) 
    } 
 
    // Verifica se o veículo pertence ao motorista 
    const veiculo = (await query( 
      'SELECT * FROM vehicles WHERE id = $1 AND driver_id = $2', 
      [vehicleId, driver.id] 
    )).rows[0] 
    if (!veiculo) return reply.code(404).send({ error: 'Veículo não encontrado' }) 
 
    // Desativa todos os veículos do motorista 
    await query('UPDATE vehicles SET ativo = 0 WHERE driver_id = $1', [driver.id]) 
 
    // Ativa o selecionado 
    await query('UPDATE vehicles SET ativo = 1 WHERE id = $1', [vehicleId]) 
 
    // Atualiza dados do motorista com o veículo ativo 
    await query(` 
      UPDATE drivers SET 
        modelo_carro = $1, 
        ano_carro = $2, 
        cor_carro = $3, 
        placa = $4 
      WHERE id = $5 
    `, [veiculo.modelo, veiculo.ano, veiculo.cor, veiculo.placa, driver.id]) 
 
    return { mensagem: `Veículo ${veiculo.modelo} ${veiculo.placa} ativado!` } 
  }) 
 
  // Remover veículo 
  fastify.delete('/api/motorista/:token/veiculos/:vehicleId', async (request, reply) => { 
    const { token, vehicleId } = request.params 
 
    const driver = (await query( 
      'SELECT id FROM drivers WHERE token_perfil = $1', 
      [token] 
    )).rows[0] 
    if (!driver) return reply.code(404).send({ error: 'Motorista não encontrado' }) 
 
    const veiculo = (await query( 
      'SELECT * FROM vehicles WHERE id = $1 AND driver_id = $2', 
      [vehicleId, driver.id] 
    )).rows[0] 
    if (!veiculo) return reply.code(404).send({ error: 'Veículo não encontrado' }) 
 
    if (veiculo.ativo) { 
      return reply.code(400).send({ error: 'Não é possível remover o veículo ativo. Ative outro primeiro.' }) 
    } 
 
    // Verifica se tem apenas 1 veículo 
    const total = (await query( 
      'SELECT COUNT(*) as total FROM vehicles WHERE driver_id = $1', 
      [driver.id] 
    )).rows[0] 
    if (parseInt(total.total) <= 1) { 
      return reply.code(400).send({ error: 'Você precisa ter pelo menos 1 veículo cadastrado' }) 
    } 
 
    await query('DELETE FROM vehicles WHERE id = $1', [vehicleId]) 
    return { mensagem: 'Veículo removido' } 
  }) 
 
  // Rota admin — adicionar veículo para motorista 
  fastify.post('/api/drivers/:id/veiculos', { preHandler: requireAuth }, async (request, reply) => { 
    const { modelo, ano, cor, placa } = request.body 
    const { id } = request.params 
 
    if (!modelo || !ano || !cor || !placa) { 
      return reply.code(400).send({ error: 'Todos os campos são obrigatórios' }) 
    } 
 
    const existing = (await query('SELECT id FROM vehicles WHERE placa = $1', [placa.toUpperCase()])).rows[0] 
    if (existing) return reply.code(409).send({ error: 'Placa já cadastrada' }) 
 
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
 
    return { mensagem: 'Veículo cadastrado!', veiculo: result.rows[0] } 
  }) 
}
