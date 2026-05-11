import TelegramBot from 'node-telegram-bot-api' 
import { query as dbQuery, pool } from './db.js'
import { getIo } from './server.js' 
 
let bot 
 
export function initBot() { 
   const token = process.env.TELEGRAM_TOKEN 
   if (!token) { console.warn('[BOT] Token não configurado'); return } 
 
   const isProduction = process.env.BASE_URL && !process.env.BASE_URL.includes('localhost') 
 
   // Cria o bot sempre com polling: false 
   // No local, vamos usar polling manualmente 
   bot = new TelegramBot(token, { polling: false }) 
 
   // Registra handlers ANTES de iniciar polling 
   registrarHandlers() 
 
   if (!isProduction) { 
     // Inicia polling apenas em desenvolvimento local 
     bot.startPolling() 
     console.log('[BOT] Modo polling (local)') 
   } else { 
     console.log('[BOT] Modo webhook (produção)') 
   } 
 } 
 
 function registrarHandlers() { 
   // Handler de localização 
   bot.on('location', async (msg) => { 
     const { lat, lng } = { lat: msg.location.latitude, lng: msg.location.longitude } 
     const telegramId = String(msg.from.id) 
 
     const driver = (await dbQuery( 
       'SELECT * FROM drivers WHERE telegram_id = $1 AND ativo = 1', [telegramId] 
     )).rows[0] 
     if (!driver) return 
 
     const ride = (await dbQuery( 
       "SELECT * FROM rides WHERE driver_id = $1 AND status = 'aceita' ORDER BY aceita_at DESC LIMIT 1", 
       [driver.id] 
     )).rows[0] 
     if (!ride) return 
 
     const existing = (await dbQuery( 
       'SELECT id FROM driver_locations WHERE ride_id = $1', [ride.id] 
     )).rows[0] 
 
     if (existing) { 
       await dbQuery( 
         'UPDATE driver_locations SET lat = $1, lng = $2, updated_at = CURRENT_TIMESTAMP WHERE ride_id = $3', 
         [lat, lng, ride.id] 
       ) 
     } else { 
       await dbQuery( 
         'INSERT INTO driver_locations (driver_id, ride_id, lat, lng) VALUES ($1, $2, $3, $4)', 
         [driver.id, ride.id, lat, lng] 
       ) 
     } 
   }) 
 
   // Handler de callback_query (botões inline) 
   bot.on('callback_query', async (query) => { 
     const { data, from, message } = query 
     if (!data) return 
 
     console.log('[BOT] callback_query:', data, 'from:', from.id) 
 
     // ACEITAR CORRIDA 
     if (data.startsWith('accept:')) { 
       const rideId = parseInt(data.split(':')[1]) 
 
       const driver = (await dbQuery( 
         "SELECT * FROM drivers WHERE telegram_id = $1 AND ativo = 1 AND status_cadastro = 'aprovado'", 
         [String(from.id)] 
       )).rows[0] 
 
       if (!driver) { 
         bot.answerCallbackQuery(query.id, { text: '❌ Motorista não encontrado ou inativo.', show_alert: true }) 
         return 
       } 
 
       // Tenta aceitar a corrida atomicamente 
       const result = await dbQuery(` 
         UPDATE rides SET 
           status = 'aceita', 
           driver_id = $1, 
           aceita_at = CURRENT_TIMESTAMP 
         WHERE id = $2 AND status = 'aberta' 
         RETURNING * 
       `, [driver.id, rideId]) 
 
       if (!result.rows.length) { 
         bot.answerCallbackQuery(query.id, { text: '⚠️ Corrida já foi aceita por outro motorista.', show_alert: true }) 
         return 
       } 
 
       const ride = result.rows[0] 

       bot.answerCallbackQuery(query.id, { text: '✅ Corrida aceita!' }) 

       // Emite evento socket.io para redirecionar o passageiro
       const io = getIo()
       if (io) {
         io.to(`ride:${rideId}`).emit('corrida:aceita', { token: ride.token, rideId: rideId, driver_id: driver.id })
       }

       // Edita mensagem no grupo 
       try { 
         await editGroupMessage( 
           message.message_id, 
           `✅ *Corrida aceita!*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}\n💰 R$ ${Number(ride.valor).toFixed(2)}\n\n🧑‍✈️ *${driver.nome}*\n🚗 ${driver.modelo_carro} ${driver.cor_carro} — ${driver.placa}` 
         ) 
       } catch(e) {} 
 
       // Busca dados do cliente 
       let clienteNome = 'Passageiro' 
       if (ride.client_id) { 
         const client = (await dbQuery('SELECT nome FROM clients WHERE id = $1', [ride.client_id])).rows[0] 
         if (client?.nome) clienteNome = client.nome 
       } 
 
       // Busca token do perfil 
       const driverComToken = (await dbQuery('SELECT token_perfil FROM drivers WHERE id = $1', [driver.id])).rows[0] 
 
       // Links de navegação 
       const linkNavegar = ride.origem_lat 
         ? `https://www.google.com/maps/dir/?api=1&destination=${ride.origem_lat},${ride.origem_lng}&travelmode=driving` 
         : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ride.origem)}&travelmode=driving` 
 
       const linkRota = ride.origem_lat && ride.destino_lat 
         ? `https://www.google.com/maps/dir/?api=1&origin=${ride.origem_lat},${ride.origem_lng}&destination=${ride.destino_lat},${ride.destino_lng}&travelmode=driving` 
         : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ride.destino)}&travelmode=driving` 
 
       // Mensagem privada para o motorista 
       const msgMotorista = `🚗 *Corrida aceita!*\n\n👤 Passageiro: *${clienteNome}*\n📍 Origem: ${ride.origem}\n🏁 Destino: ${ride.destino}\n💰 Valor total: R$ ${Number(ride.valor).toFixed(2)}\n👨‍✈️ Seu recebimento: R$ ${Number(ride.valor_motorista || ride.valor * 0.70).toFixed(2)}\n\n⚠️ Compartilhe sua localização ao vivo aqui no bot para o passageiro acompanhar.` 
 
       bot.sendMessage(from.id, msgMotorista, { 
         parse_mode: 'Markdown', 
         reply_markup: { 
           inline_keyboard: [ 
             [{ text: '🧭 Navegar até o passageiro', url: linkNavegar }], 
             [{ text: '🗺️ Ver rota completa', url: linkRota }], 
             [{ text: '📍 Cheguei ao passageiro', callback_data: `chegou:${ride.id}` }], 
             [{ text: '🚶 Passageiro embarcou', callback_data: `embarcou:${ride.id}` }], 
             [{ text: '⏸️ Iniciar parada', callback_data: `parada_ini:${ride.id}` }], 
             [{ text: '✅ Finalizar corrida', callback_data: `finalizar:${ride.id}` }] 
           ] 
         } 
       }).catch(() => {}) 
 
       // Atualiza contadores 
       await dbQuery('UPDATE drivers SET total_viagens = total_viagens + 1 WHERE id = $1', [driver.id]) 
       if (ride.client_id) { 
         await dbQuery('UPDATE clients SET total_corridas = total_corridas + 1 WHERE id = $1', [ride.client_id]) 
       } 
 
       return 
     } 
 
     // CHEGOU AO PASSAGEIRO 
     if (data.startsWith('chegou:')) { 
       const rideId = parseInt(data.split(':')[1]) 
       await dbQuery(` 
         UPDATE rides SET status_detalhe = 'aguardando_passageiro', motorista_chegou_at = CURRENT_TIMESTAMP 
         WHERE id = $1 AND motorista_chegou_at IS NULL 
       `, [rideId]) 
       bot.answerCallbackQuery(query.id, { text: '📍 Chegada registrada! Timer iniciado.', show_alert: true }) 
       bot.sendMessage(from.id, 
         `📍 *Chegada registrada!*\n\n⏱️ Você tem 5 minutos grátis de espera.\nApós isso: R$ 0,60/min`, 
         { parse_mode: 'Markdown' } 
       ).catch(() => {}) 
       return 
     } 
 
     // PASSAGEIRO EMBARCOU 
     if (data.startsWith('embarcou:')) { 
       const rideId = parseInt(data.split(':')[1]) 
       const ride = (await dbQuery('SELECT * FROM rides WHERE id = $1', [rideId])).rows[0] 
       if (!ride?.motorista_chegou_at) { 
         bot.answerCallbackQuery(query.id, { text: 'Registre chegada primeiro!', show_alert: true }) 
         return 
       } 
       const { calcularTempoMinutos, calculateInitialWaitCost } = await import('./billing.js') 
       const configs = (await dbQuery('SELECT chave, valor FROM configuracoes')).rows 
       const config = {} 
       configs.forEach(c => config[c.chave] = c.valor) 
       const tempoEspera = calcularTempoMinutos(ride.motorista_chegou_at) 
       const custoEspera = calculateInitialWaitCost(tempoEspera, config) 
       await dbQuery(` 
         UPDATE rides SET status_detalhe = 'em_andamento', passageiro_embarcou_at = CURRENT_TIMESTAMP, 
         tempo_espera_inicial_min = $1, custo_espera_inicial = $2 WHERE id = $3 
       `, [tempoEspera, custoEspera, rideId]) 
       const msg = custoEspera > 0 
         ? `🚶 *Passageiro embarcou!*\n\n⏱️ Espera: ${tempoEspera.toFixed(1)} min\n💰 Custo: R$ ${custoEspera.toFixed(2)}` 
         : `🚶 *Passageiro embarcou!*\n\n⏱️ Espera: ${tempoEspera.toFixed(1)} min (dentro do grátis)` 
       bot.answerCallbackQuery(query.id, { text: 'Corrida iniciada!' }) 
       bot.sendMessage(from.id, msg, { parse_mode: 'Markdown' }).catch(() => {}) 
       return 
     } 
 
     // INICIAR PARADA 
     if (data.startsWith('parada_ini:')) { 
       const rideId = parseInt(data.split(':')[1]) 
       const paradaAberta = (await dbQuery( 
         'SELECT id FROM ride_stops WHERE ride_id = $1 AND finalizada_at IS NULL', [rideId] 
       )).rows[0] 
       if (paradaAberta) { bot.answerCallbackQuery(query.id, { text: 'Já existe parada em andamento!', show_alert: true }); return } 
       const result = await dbQuery('INSERT INTO ride_stops (ride_id) VALUES ($1) RETURNING id', [rideId]) 
       await dbQuery("UPDATE rides SET status_detalhe = 'em_parada', num_paradas = num_paradas + 1 WHERE id = $1", [rideId]) 
       bot.answerCallbackQuery(query.id, { text: '⏸️ Parada iniciada! 5 min grátis.', show_alert: true }) 
       bot.sendMessage(from.id, `⏸️ *Parada iniciada*\n\n⏱️ 5 minutos grátis\nApós isso: R$ 0,60/min`, { 
         parse_mode: 'Markdown', 
         reply_markup: { inline_keyboard: [[{ text: '▶️ Retomar corrida', callback_data: `parada_fim:${rideId}:${result.rows[0].id}` }]] } 
       }).catch(() => {}) 
       return 
     } 
 
     // FINALIZAR PARADA 
     if (data.startsWith('parada_fim:')) { 
       const parts = data.split(':') 
       const rideId = parseInt(parts[1]) 
       const stop = (await dbQuery( 
         'SELECT * FROM ride_stops WHERE ride_id = $1 AND finalizada_at IS NULL ORDER BY iniciada_at DESC LIMIT 1', [rideId] 
       )).rows[0] 
       if (!stop) { bot.answerCallbackQuery(query.id, { text: 'Nenhuma parada em andamento', show_alert: true }); return } 
       const { calcularTempoMinutos, calculateStopCost } = await import('./billing.js') 
       const configs = (await dbQuery('SELECT chave, valor FROM configuracoes')).rows 
       const config = {} 
       configs.forEach(c => config[c.chave] = c.valor) 
       const duracao = calcularTempoMinutos(stop.iniciada_at) 
       const custo = calculateStopCost(duracao, config) 
       await dbQuery('UPDATE ride_stops SET finalizada_at = CURRENT_TIMESTAMP, duracao_min = $1, custo = $2 WHERE id = $3', [duracao, custo, stop.id]) 
       const totalParadas = (await dbQuery( 
         'SELECT COALESCE(SUM(custo),0) as total, COALESCE(SUM(duracao_min),0) as tempo FROM ride_stops WHERE ride_id = $1', [rideId] 
       )).rows[0] 
       await dbQuery("UPDATE rides SET status_detalhe = 'em_andamento', custo_paradas = $1, tempo_paradas_total_min = $2 WHERE id = $3", 
         [totalParadas.total, totalParadas.tempo, rideId]) 
       bot.answerCallbackQuery(query.id, { text: '▶️ Corrida retomada!' }) 
       bot.sendMessage(from.id, `▶️ *Corrida retomada!*\n\n⏱️ Parada: ${duracao.toFixed(1)} min\n💰 Custo: R$ ${custo.toFixed(2)}`, 
         { parse_mode: 'Markdown' }).catch(() => {}) 
       return 
     } 
 
     // FINALIZAR CORRIDA 
    if (data.startsWith('finalizar:')) { 
      const rideId = parseInt(data.split(':')[1]) 
      const ride = (await dbQuery(` 
        SELECT id, valor, valor_motorista, custo_espera_inicial, custo_paradas, 
          num_paradas, tempo_espera_inicial_min, tempo_paradas_total_min, 
          origem, destino, telegram_message_id, client_id, driver_id 
        FROM rides WHERE id = $1 
      `, [rideId])).rows[0] 
      if (!ride) { bot.answerCallbackQuery(query.id, { text: 'Corrida não encontrada', show_alert: true }); return } 
 
      const { calculateTotalRideCost, calculateInitialWaitCost } = await import('./billing.js') 
      const configs = (await dbQuery('SELECT chave, valor FROM configuracoes')).rows 
      const config = {} 
      configs.forEach(c => config[c.chave] = c.valor) 
 
      // Cálculo detalhado para memória de cálculo 
      const waitInfo = calculateInitialWaitCost(ride.tempo_espera_inicial_min || 0, config) 
      const valorFinal = calculateTotalRideCost(ride.valor || 0, waitInfo.cost, ride.custo_paradas || 0, config) 
      const valorMotorista = parseFloat((valorFinal * 0.70).toFixed(2)) 
 
      await dbQuery(` 
        UPDATE rides SET 
          status = 'concluida', 
          concluida_at = CURRENT_TIMESTAMP, 
          valor_final = $1, 
          valor_motorista = $2, 
          valor_mobihub = $3, 
          base_value = $4, 
          wait_extra_minutes = $5, 
          wait_extra_charge = $6, 
          stop_extra_minutes = $7, 
          stop_extra_charge = $8, 
          total_value = $9 
        WHERE id = $10 
      `, [ 
        valorFinal, 
        valorMotorista, 
        parseFloat((valorFinal - valorMotorista).toFixed(2)), 
        ride.valor || 0, 
        waitInfo.extraMinutes, 
        waitInfo.cost, 
        ride.tempo_paradas_total_min || 0, 
        ride.custo_paradas || 0, 
        valorFinal, 
        rideId 
      ]) 
 
      if (ride.client_id) await dbQuery('UPDATE clients SET total_corridas = total_corridas + 1 WHERE id = $1', [ride.client_id]) 
       try { 
         if (ride.telegram_message_id) await editGroupMessage(ride.telegram_message_id, 
           `✅ *Corrida concluída!*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}\n💰 R$ ${valorFinal.toFixed(2)}`) 
         const driver = (await dbQuery('SELECT * FROM drivers WHERE id = $1', [ride.driver_id])).rows[0] 
         if (driver) await notifyDriverRateClient(driver, ride) 
       } catch(e) {} 
       bot.answerCallbackQuery(query.id, { text: '✅ Corrida finalizada!' }) 
       bot.sendMessage(from.id, `✅ *Corrida finalizada!*\n\n💰 Valor final: R$ ${valorFinal.toFixed(2)}\n👨‍✈️ Seu ganho: R$ ${valorMotorista.toFixed(2)}`, 
         { parse_mode: 'Markdown' }).catch(() => {}) 
       return 
     } 
 
     // AVALIAR CLIENTE 
     if (data.startsWith('rate_client:')) { 
       const parts = data.split(':') 
       const rideId = parseInt(parts[1]) 
       const estrelas = parseInt(parts[2]) 
       const driver = (await dbQuery('SELECT * FROM drivers WHERE telegram_id = $1', [String(from.id)])).rows[0] 
       if (!driver) return 
       const existing = (await dbQuery('SELECT * FROM ratings WHERE ride_id = $1', [rideId])).rows[0] 
       if (existing) { 
         if (existing.estrelas_cliente) { bot.answerCallbackQuery(query.id, { text: 'Você já avaliou este passageiro.' }); return } 
         await dbQuery('UPDATE ratings SET estrelas_cliente = $1, avaliado_em_motorista = CURRENT_TIMESTAMP WHERE ride_id = $2', [estrelas, rideId]) 
       } else { 
         await dbQuery('INSERT INTO ratings (ride_id, estrelas_cliente, avaliado_em_motorista) VALUES ($1, $2, CURRENT_TIMESTAMP)', [rideId, estrelas]) 
       } 
       if (driver.id) { 
         const stats = (await dbQuery(` 
           SELECT AVG(estrelas_cliente) as media, COUNT(estrelas_cliente) as total 
           FROM ratings WHERE ride_id IN (SELECT id FROM rides WHERE client_id = (SELECT client_id FROM rides WHERE id = $1)) 
           AND estrelas_cliente IS NOT NULL 
         `, [rideId])).rows[0] 
         const ride = (await dbQuery('SELECT client_id FROM rides WHERE id = $1', [rideId])).rows[0] 
         if (ride?.client_id) { 
           await dbQuery('UPDATE clients SET media_avaliacao = $1, total_avaliacoes = $2 WHERE id = $3', 
             [stats.media, stats.total, ride.client_id]) 
         } 
       } 
       bot.answerCallbackQuery(query.id, { text: '⭐ Avaliação registrada! Obrigado.' }) 
       bot.editMessageText('✅ Avaliação registrada! Obrigado pelo feedback.', 
         { chat_id: from.id, message_id: message.message_id }).catch(() => {}) 
       return 
     } 
   }) 
 
   bot.on('polling_error', (err) => { 
     if (err.code !== 'ETELEGRAM') console.error('[BOT] Erro:', err.message) 
   }) 
 } 
 
export async function sendRideToGroup(ride) { 
  // Verifica se há motoristas online 
  const motoristasOnline = (await dbQuery( 
    "SELECT COUNT(*) as total FROM drivers WHERE ativo = 1 AND online = 1 AND status_cadastro = 'aprovado'", 
    [] 
  )).rows[0] 
 
  const qtdOnline = parseInt(motoristasOnline?.total || 0) 
 
  if (qtdOnline === 0) { 
    console.log('[BOT] Nenhum motorista online — corrida criada mas não disparada') 
    return null 
  } 
 
  const isAgendada = ride.tipo === 'agendada' 
  const valorMotorista = ride.valor_motorista 
    ? `R$ ${Number(ride.valor_motorista).toFixed(2)}` 
    : `R$ ${(ride.valor * 0.70).toFixed(2)}` 
 
  const titulo = isAgendada 
    ? `🗓️ *Novo agendamento disponível!*` 
    : `🚗 *Nova corrida disponível!*` 
 
  const dataAgendada = isAgendada && ride.agendada_para 
    ? `\n📅 Data: ${new Date(ride.agendada_para).toLocaleString('pt-BR')}` 
    : '' 
 
  const infoOnline = qtdOnline > 0 
    ? `\n👥 ${qtdOnline} motorista${qtdOnline > 1 ? 's' : ''} online` 
    : '\n⚠️ Nenhum motorista online' 
 
  // Busca dados do passageiro 
  let infoPassageiro = '' 
  if (ride.client_id) { 
    const clientResult = await dbQuery('SELECT nome, media_avaliacao, total_avaliacoes FROM clients WHERE id = $1', [ride.client_id]) 
    const client = clientResult.rows[0] 
    if (client) { 
      const nome = client.nome || 'Passageiro' 
      const media = client.media_avaliacao 
        ? `⭐ ${Number(client.media_avaliacao).toFixed(1)}` 
        : '⭐ Novo' 
      infoPassageiro = `\n👤 Passageiro: *${nome}* ${media}` 
    } 
  } 
 
  const linkPassageiro = (ride.origem_lat && ride.origem_lng) 
    ? `https://www.google.com/maps?q=${ride.origem_lat},${ride.origem_lng}` 
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ride.origem)}` 
 
  const linkNavegar = (ride.origem_lat && ride.origem_lng) 
    ? `https://www.google.com/maps/dir/?api=1&destination=${ride.origem_lat},${ride.origem_lng}&travelmode=driving` 
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ride.origem)}&travelmode=driving` 
 
  const texto = ` 
${titulo} 
 
📍 Origem: ${ride.origem} 
🏁 Destino: ${ride.destino}${dataAgendada}${infoPassageiro} 
💰 Valor total: R$ ${Number(ride.valor).toFixed(2)} 
👨‍✈️ Seu recebimento (70%): *${valorMotorista}* 
${infoOnline} 
 
📌 Toque para ver onde o passageiro está: 
  `.trim() 
 
  const msg = await bot.sendMessage(process.env.TELEGRAM_GROUP_ID, texto, { 
    parse_mode: 'Markdown', 
    reply_markup: { 
      inline_keyboard: [ 
        [ 
          { text: '📌 Ver passageiro no mapa', url: linkPassageiro }, 
          { text: '🧭 Como chegar', url: linkNavegar } 
        ], 
        [ 
          { text: isAgendada ? '📅 Aceitar agendamento' : '✅ Aceitar corrida', 
            callback_data: `accept:${ride.id}` } 
        ] 
      ] 
    } 
  }) 
 
  return msg.message_id 
} 
 
export async function notifyDriverRateClient(driver, ride) { 
  const keyboard = { 
    inline_keyboard: [[ 
      { text: '⭐ 1', callback_data: `rate_client:${ride.id}:1` }, 
      { text: '⭐ 2', callback_data: `rate_client:${ride.id}:2` }, 
      { text: '⭐ 3', callback_data: `rate_client:${ride.id}:3` }, 
      { text: '⭐ 4', callback_data: `rate_client:${ride.id}:4` }, 
      { text: '⭐ 5', callback_data: `rate_client:${ride.id}:5` } 
    ]] 
  } 
 
  bot.sendMessage( 
    driver.telegram_id, 
    `✅ Corrida concluída!\n\nComo foi o passageiro? Avalie de 1 a 5 estrelas:`, 
    { reply_markup: keyboard } 
  ).catch(() => { 
    console.warn(`[BOT] Não foi possível enviar avaliação para ${driver.telegram_id}`) 
  }) 
} 
 
export async function editGroupMessage(messageId, texto) { 
  bot.editMessageText(texto, { 
    chat_id: process.env.TELEGRAM_GROUP_ID, 
    message_id: messageId, 
    parse_mode: 'Markdown' 
  }).catch(() => {}) 
} 
 
export function getBot() { 
  return bot 
} 
