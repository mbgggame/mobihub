import { db } from '../db.js' 
import { requireAuth } from '../middleware/auth.js' 
import { sendRideToGroup, notifyDriverRateClient, editGroupMessage } from '../telegram.js' 
import { v4 as uuidv4 } from 'uuid' 
 
function calcularTarifa(dataHoraStr, distanciaKm) { 
  const data = new Date(dataHoraStr) 
  const diaSemana = data.getDay() 
  const hora = data.getHours() 
  const minuto = data.getMinutes() 
  const horaDecimal = hora + minuto / 60 

  const tarifas = db.prepare('SELECT * FROM tarifas WHERE ativo = 1').all() 

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
    tarifaAplicada = db.prepare('SELECT * FROM tarifas ORDER BY valor_minimo ASC LIMIT 1').get() 
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
 
    let query = ` 
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
      query += ' WHERE r.status = ?' 
      params.push(status) 
    } 
    query += ' ORDER BY r.created_at DESC' 
 
    return db.prepare(query).all(...params) 
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
      let client = db.prepare('SELECT * FROM clients WHERE telefone = ?').get(client_telefone) 
      if (!client) { 
        const r = db.prepare('INSERT INTO clients (telefone) VALUES (?)').run(client_telefone) 
        clientId = r.lastInsertRowid 
      } else { 
        clientId = client.id 
      } 
    } 
 
    const token = uuidv4() 
    const statusInicial = tipo === 'agendada' ? 'agendada' : 'aberta' 
 
    const result = db.prepare(` 
      INSERT INTO rides 
        (token, client_id, origem, origem_lat, origem_lng, destino, destino_lat, 
         destino_lng, valor, valor_motorista, valor_mobihub, tipo, agendada_para, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
    `).run(token, clientId, origem, origem_lat, origem_lng, destino, 
           destino_lat, destino_lng, valor, valor_motorista || null, 
           valor_mobihub || null, tipo || 'normal', agendada_para || null, statusInicial) 
 
    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(result.lastInsertRowid) 
 
    // Só dispara imediatamente se for corrida NORMAL 
    if (!tipo || tipo === 'normal') { 
      try { 
        const messageId = await sendRideToGroup(ride) 
        db.prepare('UPDATE rides SET telegram_message_id = ? WHERE id = ?').run(messageId, ride.id) 
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
 
    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(id) 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
 
    let updateQuery = 'UPDATE rides SET status = ?' 
    const params = [status] 
 
    if (status === 'concluida') { 
      updateQuery += ', concluida_at = CURRENT_TIMESTAMP' 
    } else if (status === 'cancelada') { 
      updateQuery += ', cancelada_at = CURRENT_TIMESTAMP' 
    } 
 
    updateQuery += ' WHERE id = ?' 
    params.push(id) 
 
    db.prepare(updateQuery).run(...params) 
 
    if (status === 'concluida') { 
      if (ride.driver_id) { 
        const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(ride.driver_id) 
        if (driver) { 
          console.log('[DEBUG] Enviando avaliação para motorista:', driver.telegram_id) 
          try { 
            await notifyDriverRateClient(driver, ride) 
            console.log('[DEBUG] Avaliação enviada com sucesso') 
          } catch(err) { 
            console.error('[DEBUG] Erro ao enviar avaliação:', err.message) 
          } 
          db.prepare('UPDATE drivers SET total_viagens = total_viagens + 1 WHERE id = ?').run(driver.id) 
        } 
      } 
      if (ride.client_id) { 
        db.prepare('UPDATE clients SET total_corridas = total_corridas + 1 WHERE id = ?').run(ride.client_id) 
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
 
    const ride = db.prepare('SELECT id FROM rides WHERE id = ?').get(id) 
    if (!ride) return reply.code(404).send({ error: 'Corrida não encontrada' }) 
 
    db.prepare('UPDATE rides SET maps_link = ? WHERE id = ?').run(maps_link, id) 
    return { mensagem: 'Link do mapa salvo' } 
  }) 
 
  // Listar tarifas 
  fastify.get('/api/tarifas', { preHandler: requireAuth }, async () => { 
    return db.prepare('SELECT * FROM tarifas ORDER BY valor_minimo').all() 
  }) 
 
  // Atualizar tarifa 
  fastify.put('/api/tarifas/:id', { preHandler: requireAuth }, async (request, reply) => { 
    const { nome, dias, hora_inicio, hora_fim, valor_minimo, valor_km, km_minimo, ativo } = request.body 
    const { id } = request.params 
    db.prepare(` 
      UPDATE tarifas SET 
        nome = COALESCE(?, nome), 
        dias = COALESCE(?, dias), 
        hora_inicio = COALESCE(?, hora_inicio), 
        hora_fim = COALESCE(?, hora_fim), 
        valor_minimo = COALESCE(?, valor_minimo), 
        valor_km = COALESCE(?, valor_km), 
        km_minimo = COALESCE(?, km_minimo), 
        ativo = COALESCE(?, ativo) 
      WHERE id = ? 
    `).run(nome, dias, hora_inicio, hora_fim, valor_minimo, valor_km, km_minimo, ativo, id) 
    return { mensagem: 'Tarifa atualizada' } 
  }) 
 
  // Rota pública para o cliente calcular o valor 
  fastify.get('/api/tarifas/calcular', async (request) => { 
    const { data_hora, distancia_km } = request.query 
    const resultado = calcularTarifa(data_hora, parseFloat(distancia_km)) 
    return resultado 
  }) 
 
  // Métricas para o Dashboard 
  fastify.get('/api/metricas', { preHandler: requireAuth }, async () => { 
    const hoje = new Date().toLocaleDateString('pt-BR').split('/').reverse().join('-') 
 
    const resumoDia = db.prepare(` 
      SELECT 
        COUNT(*) as total_hoje, 
        ROUND(SUM(CASE WHEN status = 'concluida' THEN valor ELSE 0 END), 2) as receita_hoje, 
        SUM(CASE WHEN status = 'aberta' THEN 1 ELSE 0 END) as abertas, 
        SUM(CASE WHEN status = 'agendada' THEN 1 ELSE 0 END) as agendadas, 
        SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) as concluidas 
      FROM rides 
      WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') 
    `).get() 
 
    const motoristasAtivos = db.prepare( 
      'SELECT COUNT(*) as total FROM drivers WHERE ativo = 1' 
    ).get() 
 
    const ultimos15dias = db.prepare(` 
      SELECT 
        DATE(created_at) as dia, 
        COUNT(*) as corridas, 
        ROUND(SUM(CASE WHEN status='concluida' THEN valor ELSE 0 END), 2) as receita, 
        SUM(CASE WHEN status='concluida' THEN 1 ELSE 0 END) as concluidas 
      FROM rides 
      WHERE created_at >= datetime('now', '-15 days') 
      GROUP BY DATE(created_at) 
      ORDER BY dia ASC 
    `).all() 
 
    const tempoMedioAceite = db.prepare(` 
      SELECT ROUND(AVG((julianday(aceita_at) - julianday(created_at)) * 1440), 1) as minutos 
      FROM rides WHERE aceita_at IS NOT NULL AND created_at >= datetime('now', '-15 days') 
    `).get() 
 
    const topMotoristas = db.prepare(` 
      SELECT d.nome, d.total_viagens, ROUND(d.media_avaliacao, 1) as nota, 
        ROUND(SUM(r.valor), 2) as receita 
      FROM drivers d JOIN rides r ON r.driver_id = d.id 
      WHERE r.status = 'concluida' 
      GROUP BY d.id ORDER BY receita DESC LIMIT 5 
    `).all() 
 
    const avaliacaoMedia = db.prepare(` 
      SELECT ROUND(AVG(estrelas_motorista), 1) as motoristas, 
        ROUND(AVG(estrelas_cliente), 1) as clientes 
      FROM ratings 
    `).get() 
 
    const corridasAtivas = db.prepare(` 
      SELECT r.*, d.nome as driver_nome, d.placa 
      FROM rides r LEFT JOIN drivers d ON r.driver_id = d.id 
      WHERE r.status IN ('aberta', 'aceita', 'agendada') 
      ORDER BY r.created_at DESC 
    `).all() 
 
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
    const configs = db.prepare('SELECT * FROM configuracoes').all() 
    const obj = {} 
    configs.forEach(c => obj[c.chave] = c.valor) 
    return obj 
  }) 
 
  fastify.put('/api/configuracoes', { preHandler: requireAuth }, async (request) => { 
    const configs = request.body 
    const upsert = db.prepare(` 
      INSERT INTO configuracoes (chave, valor) VALUES (?, ?) 
      ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor 
    `) 
    const transaction = db.transaction((configs) => { 
      for (const [chave, valor] of Object.entries(configs)) { 
        upsert.run(chave, String(valor)) 
      } 
    }) 
    transaction(configs) 
    return { mensagem: 'Configurações salvas' } 
  }) 
 
  fastify.get('/api/clients', { preHandler: requireAuth }, async () => { 
    return db.prepare(` 
      SELECT id, nome, telefone, total_corridas, media_avaliacao, total_avaliacoes 
      FROM clients ORDER BY nome 
    `).all() 
  }) 
}
