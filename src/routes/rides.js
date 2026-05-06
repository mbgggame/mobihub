import { query as dbQuery, pool } from '../db.js' 
import { requireAuth } from '../middleware/auth.js' 
import { sendRideToGroup, notifyDriverRateClient, editGroupMessage } from '../telegram.js' 
import { v4 as uuidv4 } from 'uuid' 
 
async function calcularTarifa(dataHoraStr, distanciaKm) { 
  const data = new Date(dataHoraStr) 
  const diaSemana = data.getDay() 
  const hora = data.getHours() 
  const minuto = data.getMinutes() 
  const horaDecimal = hora + minuto / 60 

  const resultTarifas = await dbQuery('SELECT * FROM tarifas WHERE ativo = 1') 
  const tarifas = resultTarifas.rows

  let tarifaAplicada = null 
  let maiorValor = 0 

  for (const t of tarifas) { 
    const dias = t.dias.split(',').map(Number) 
    if (!dias.includes(diaSemana)) continue 

    const [hIni, mIni] = t.hora_inicio.split(':').map(Number) 
    const [hFim, mFim] = t.hora_fim.split(':').map(Number) 
    const inicio = hIni + mIni / 60 
    const fim = hFim + mFim / 60 

    let dentro = false 
    if (inicio <= fim) { 
      dentro = horaDecimal >= inicio && horaDecimal < fim 
    } else { 
      dentro = horaDecimal >= inicio || horaDecimal < fim 
    } 

    if (dentro && t.valor_minimo > maiorValor) { 
      maiorValor = t.valor_minimo 
      tarifaAplicada = t 
    } 
  } 

  if (!tarifaAplicada) { 
    const res = await dbQuery('SELECT * FROM tarifas ORDER BY valor_minimo ASC LIMIT 1')
    tarifaAplicada = res.rows[0]
  } 

  const excedente = Math.max(0, distanciaKm - tarifaAplicada.km_minimo) 
  const valor = tarifaAplicada.valor_minimo + (excedente * tarifaAplicada.valor_km) 
  const valorMotorista = parseFloat((valor * 0.70).toFixed(2)) 
  const valorMobihub = parseFloat((valor * 0.30).toFixed(2)) 

  return { 
    tarifa: tarifaAplicada.nome, 
    valor: parseFloat(valor.toFixed(2)), 
    valor_motorista: valorMotorista, 
    valor_mobihub: valorMobihub, 
    distancia_km: distanciaKm, 
    valor_minimo: tarifaAplicada.valor_minimo, 
    valor_km: tarifaAplicada.valor_km 
  } 
} 
 
export default async function ridesRoutes(fastify) { 
 
  fastify.get('/api/rides', { preHandler: requireAuth }, async (request) => { 
    const { status } = request.query 
 
    let sql = ` 
      SELECT r.*, 
        d.nome as driver_nome, d.modelo_carro, d.cor_carro, d.ano_carro, 
        d.placa, d.telefone as driver_telefone, 
        d.media_avaliacao as driver_media, d.total_viagens as driver_viagens, 
        c.telefone as client_telefone, c.nome as client_nome 
      FROM rides r 
      LEFT JOIN drivers d ON r.driver_id = d.id 
      LEFT JOIN clients c ON r.client_id = c.id 
    ` 
    const params = [] 
    if (status) { 
      sql += ' WHERE r.status = $1' 
      params.push(status) 
    } 
    sql += ' ORDER BY r.created_at DESC' 
 
    const result = await dbQuery(sql, params)
    return result.rows
  }) 
 
  fastify.post('/api/rides', { preHandler: requireAuth }, async (request, reply) => { 
    const { 
      origem, origem_lat, origem_lng, 
      destino, destino_lat, destino_lng, 
      valor, valor_motorista, valor_mobihub, client_telefone, 
      tipo, agendada_para 
    } = request.body 
 
    if (!origem || !destino || !valor) { 
      return reply.code(400).send({ error: 'Origem, destino e valor são obrigatórios' }) 
    } 
 
    // Cria ou encontra o cliente pelo telefone 
    let clientId = null 
    if (client_telefone) { 
      let clientResult = await dbQuery('SELECT * FROM clients WHERE telefone = $1', [client_telefone])
      let client = clientResult.rows[0]
      if (!client) { 
        const r = await dbQuery('INSERT INTO clients (telefone) VALUES ($1) RETURNING id', [client_telefone]) 
        clientId = r.rows[0].id 
      } else { 
        clientId = client.id 
      } 
    } 
 
    const token = uuidv4() 
    const statusInicial = tipo === 'agendada' ? 'agendada' : 'aberta' 
 
    const result = await dbQuery(` 
      INSERT INTO rides 
        (token, client_id, origem, origem_lat, origem_lng, destino, destino_lat, 
         destino_lng, valor, valor_motorista, valor_mobihub, tipo, agendada_para, status) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
      RETURNING id
    `, [token, clientId, origem, origem_lat, origem_lng, destino, 
           destino_lat, destino_lng, valor, valor_motorista || null, 
           valor_mobihub || null, tipo || 'normal', agendada_para || null, statusInicial]) 
 
    const rideId = result.rows[0].id
    const rideResult = await dbQuery('SELECT * FROM rides WHERE id = $1', [rideId]) 
    const ride = rideResult.rows[0]
 
    // Só dispara imediatamente se for corrida NORMAL 
    if (!tipo || tipo === 'normal') { 
      try { 
        const messageId = await sendRideToGroup(ride) 
        await dbQuery('UPDATE rides SET telegram_message_id = $1 WHERE id = $2', [messageId, ride.id]) 
      } catch (err) { 
        console.error('[RIDES] Erro ao enviar para Telegram:', err.message) 
      } 
    } 
 
    return { 
      id: ride.id, 
      token: ride.token, 
      link: `${process.env.BASE_URL}/r/${token}`, 
      mensagem: tipo === 'agendada' ? 'Corrida agendada com sucesso' : 'Corrida criada e enviada para o grupo Telegram' 
    } 
  }) 
 
  fastify.put('/api/rides/:id/status', { preHandler: requireAuth }, async (request, reply) => { 
    const { status } = request.body 
    const { id } = request.params 
    const statusValidos = ['aberta', 'aceita', 'concluida', 'cancelada'] 
 
    if (!statusValidos.includes(status)) { 
      return reply.code(400).send({ error: 'Status inválido' }) 
    } 
 
    const rideResult = await dbQuery('SELECT * FROM rides WHERE id = $1', [id]) 
    const ride = rideResult.rows[0]
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
 
    let updateQuery = 'UPDATE rides SET status = $1' 
    const params = [status] 
 
    if (status === 'concluida') { 
      updateQuery += ', concluida_at = CURRENT_TIMESTAMP' 
    } else if (status === 'cancelada') { 
      updateQuery += ', cancelada_at = CURRENT_TIMESTAMP' 
    } 
 
    updateQuery += ' WHERE id = $2' 
    params.push(id) 
 
    await dbQuery(updateQuery, params) 
 
    if (status === 'concluida') { 
      if (ride.driver_id) { 
        const driverResult = await dbQuery('SELECT * FROM drivers WHERE id = $1', [ride.driver_id]) 
        const driver = driverResult.rows[0]
        if (driver) { 
          console.log('[DEBUG] Enviando avaliação para motorista:', driver.telegram_id) 
          try { 
            await notifyDriverRateClient(driver, ride) 
            console.log('[DEBUG] Avaliação enviada com sucesso') 
          } catch(err) { 
            console.error('[DEBUG] Erro ao enviar avaliação:', err.message) 
          } 
          await dbQuery('UPDATE drivers SET total_viagens = total_viagens + 1 WHERE id = $1', [driver.id]) 
        } 
      } 
      if (ride.client_id) { 
        await dbQuery('UPDATE clients SET total_corridas = total_corridas + 1 WHERE id = $1', [ride.client_id]) 
      } 
      if (ride.telegram_message_id) { 
        await editGroupMessage( 
          ride.telegram_message_id, 
          `✅ *Corrida concluída!*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}\n💰 R$ ${Number(ride.valor).toFixed(2)}` 
        ) 
      } 
    } 
 
    if (status === 'cancelada' && ride.telegram_message_id) { 
      await editGroupMessage( 
        ride.telegram_message_id, 
        `❌ *Corrida cancelada.*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}` 
      ) 
    } 
 
    return { mensagem: `Status atualizado para ${status}` } 
  }) 
 
  fastify.put('/api/rides/:id/maps', { preHandler: requireAuth }, async (request, reply) => { 
    const { maps_link } = request.body 
    const { id } = request.params 
 
    const rideResult = await dbQuery('SELECT id FROM rides WHERE id = $1', [id]) 
    const ride = rideResult.rows[0]
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
 
    await dbQuery('UPDATE rides SET maps_link = $1 WHERE id = $2', [maps_link, id]) 
    return { mensagem: 'Link do mapa salvo' } 
  }) 
 
  // Listar tarifas 
  fastify.get('/api/tarifas', { preHandler: requireAuth }, async () => { 
    const result = await dbQuery('SELECT * FROM tarifas ORDER BY valor_minimo') 
    return result.rows
  }) 
 
  // Atualizar tarifa 
  fastify.put('/api/tarifas/:id', { preHandler: requireAuth }, async (request, reply) => { 
    const { nome, dias, hora_inicio, hora_fim, valor_minimo, valor_km, km_minimo, ativo } = request.body 
    const { id } = request.params 
    await dbQuery(` 
      UPDATE tarifas SET 
        nome = COALESCE($1, nome), 
        dias = COALESCE($2, dias), 
        hora_inicio = COALESCE($3, hora_inicio), 
        hora_fim = COALESCE($4, hora_fim), 
        valor_minimo = COALESCE($5, valor_minimo), 
        valor_km = COALESCE($6, valor_km), 
        km_minimo = COALESCE($7, km_minimo), 
        ativo = COALESCE($8, ativo) 
      WHERE id = $9 
    `, [nome, dias, hora_inicio, hora_fim, valor_minimo, valor_km, km_minimo, ativo, id]) 
    return { mensagem: 'Tarifa atualizada' } 
  }) 
 
  // Rota pública para o cliente calcular o valor 
  fastify.get('/api/tarifas/calcular', async (request) => { 
    const { data_hora, distancia_km } = request.query 
    const resultado = await calcularTarifa(data_hora, parseFloat(distancia_km)) 
    return resultado 
  }) 
 
  // Métricas para o Dashboard 
  fastify.get('/api/metricas', { preHandler: requireAuth }, async () => { 
    const resumoDiaResult = await dbQuery(` 
      SELECT 
        COUNT(*) as total_hoje, 
        ROUND(SUM(CASE WHEN status = 'concluida' THEN valor ELSE 0 END)::numeric, 2) as receita_hoje, 
        SUM(CASE WHEN status = 'aberta' THEN 1 ELSE 0 END) as abertas, 
        SUM(CASE WHEN status = 'agendada' THEN 1 ELSE 0 END) as agendadas, 
        SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) as concluidas 
      FROM rides 
      WHERE created_at::date = CURRENT_DATE 
    `) 
    const resumoDia = resumoDiaResult.rows[0]
 
    const motoristasAtivosResult = await dbQuery( 
      'SELECT COUNT(*) as total FROM drivers WHERE ativo = 1' 
    ) 
    const motoristasAtivos = motoristasAtivosResult.rows[0]
 
    const ultimos15diasResult = await dbQuery(` 
      SELECT 
        created_at::date as dia, 
        COUNT(*) as corridas, 
        ROUND(SUM(CASE WHEN status='concluida' THEN valor ELSE 0 END)::numeric, 2) as receita, 
        SUM(CASE WHEN status='concluida' THEN 1 ELSE 0 END) as concluidas 
      FROM rides 
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '15 days' 
      GROUP BY created_at::date 
      ORDER BY dia ASC 
    `) 
    const ultimos15dias = ultimos15diasResult.rows

    const tempoMedioAceiteResult = await dbQuery(` 
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (aceita_at - created_at)) / 60)::numeric, 1) as minutos 
      FROM rides WHERE aceita_at IS NOT NULL AND created_at >= CURRENT_TIMESTAMP - INTERVAL '15 days' 
    `) 
    const tempoMedioAceite = tempoMedioAceiteResult.rows[0]
 
    const topMotoristasResult = await dbQuery(` 
      SELECT d.nome, d.total_viagens, ROUND(d.media_avaliacao::numeric, 1) as nota, 
        ROUND(SUM(r.valor)::numeric, 2) as receita 
      FROM drivers d JOIN rides r ON r.driver_id = d.id 
      WHERE r.status = 'concluida' 
      GROUP BY d.id, d.nome, d.total_viagens, d.media_avaliacao ORDER BY receita DESC LIMIT 5 
    `) 
    const topMotoristas = topMotoristasResult.rows

    const avaliacaoMediaResult = await dbQuery(` 
      SELECT ROUND(AVG(estrelas_motorista)::numeric, 1) as motoristas, 
        ROUND(AVG(estrelas_cliente)::numeric, 1) as clientes 
      FROM ratings 
    `) 
    const avaliacaoMedia = avaliacaoMediaResult.rows[0]
 
    const corridasAtivasResult = await dbQuery(` 
      SELECT r.*, d.nome as driver_nome, d.placa 
      FROM rides r LEFT JOIN drivers d ON r.driver_id = d.id 
      WHERE r.status IN ('aberta', 'aceita', 'agendada') 
      ORDER BY r.created_at DESC 
    `) 
    const corridasAtivas = corridasAtivasResult.rows
 
    return { 
      resumoDia: { ...resumoDia, motoristas_ativos: motoristasAtivos.total }, 
      ultimos15dias, 
      tempoMedioAceite: tempoMedioAceite.minutos || 0, 
      topMotoristas, 
      avaliacaoMedia, 
      corridasAtivas 
    } 
  }) 
 
  // Configurações gerais 
  fastify.get('/api/configuracoes', { preHandler: requireAuth }, async () => { 
    const result = await dbQuery('SELECT * FROM configuracoes') 
    const configs = result.rows
    const obj = {} 
    configs.forEach(c => obj[c.chave] = c.valor) 
    return obj 
  }) 
 
  fastify.put('/api/configuracoes', { preHandler: requireAuth }, async (request) => { 
    const configs = request.body 
    
    for (const [chave, valor] of Object.entries(configs)) { 
      await dbQuery(` 
        INSERT INTO configuracoes (chave, valor) VALUES ($1, $2) 
        ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor 
      `, [chave, String(valor)]) 
    } 
    
    return { mensagem: 'Configurações salvas' } 
  }) 
 
  fastify.get('/api/clients', { preHandler: requireAuth }, async () => { 
    const result = await dbQuery(` 
      SELECT id, nome, telefone, total_corridas, media_avaliacao, total_avaliacoes 
      FROM clients ORDER BY nome 
    `) 
    return result.rows
  }) 
}
