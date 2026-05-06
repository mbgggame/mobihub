import TelegramBot from 'node-telegram-bot-api' 
import { query as dbQuery, pool } from './db.js' 
 
let bot 
 
export function initBot() { 
  bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true }) 
 
  // Recebe localização ao vivo do motorista 
  bot.on('location', async (msg) => { 
    const { lat, lng } = { lat: msg.location.latitude, lng: msg.location.longitude } 
    const telegramId = String(msg.from.id) 
 
    const driverResult = await dbQuery('SELECT * FROM drivers WHERE telegram_id = $1 AND ativo = 1', [telegramId]) 
    const driver = driverResult.rows[0] 
    if (!driver) return 
 
    // Busca corrida ativa do motorista 
    const rideResult = await dbQuery(` 
      SELECT * FROM rides 
      WHERE driver_id = $1 AND status = 'aceita' 
      ORDER BY aceita_at DESC LIMIT 1 
    `, [driver.id]) 
    const ride = rideResult.rows[0] 
 
    if (!ride) return 
 
    // Salva ou atualiza localização 
    const existingResult = await dbQuery('SELECT id FROM driver_locations WHERE ride_id = $1', [ride.id]) 
    const existing = existingResult.rows[0] 
    if (existing) { 
      await dbQuery(` 
        UPDATE driver_locations SET lat = $1, lng = $2, updated_at = CURRENT_TIMESTAMP 
        WHERE ride_id = $3 
      `, [lat, lng, ride.id]) 
    } else { 
      await dbQuery(` 
        INSERT INTO driver_locations (driver_id, ride_id, lat, lng) 
        VALUES ($1, $2, $3, $4) 
      `, [driver.id, ride.id, lat, lng]) 
    } 
  }) 
 
  bot.on('callback_query', async (callbackQuery) => { 
    const { data, from, message } = callbackQuery 
 
    // --- ACEITE DE CORRIDA --- 
    if (data.startsWith('accept:')) { 
      const rideId = parseInt(data.split(':')[1]) 
 
      const client = await pool.connect() 
      try { 
        await client.query('BEGIN') 
 
        const rideResult = await client.query( 
          "SELECT * FROM rides WHERE id = $1 AND status = 'aberta' FOR UPDATE", 
          [rideId] 
        ) 
        const ride = rideResult.rows[0] 
 
        if (!ride) { 
          await client.query('ROLLBACK') 
          bot.answerCallbackQuery(callbackQuery.id, { 
            text: 'Corrida já foi aceita ou não disponível.', 
            show_alert: true 
          }) 
          return 
        } 
 
        let driverResult = await client.query( 
          'SELECT * FROM drivers WHERE telegram_id = $1 AND ativo = 1', 
          [String(from.id)] 
        ) 
        let driver = driverResult.rows[0] 
 
        if (!driver) { 
          driverResult = await client.query( 
            'SELECT * FROM drivers WHERE CAST(telegram_id AS TEXT) = $1 AND ativo = 1', 
            [String(from.id)] 
          ) 
          driver = driverResult.rows[0] 
        } 
 
        if (!driver) { 
          await client.query('ROLLBACK') 
          bot.answerCallbackQuery(callbackQuery.id, { 
            text: 'Motorista não encontrado ou inativo.', 
            show_alert: true 
          }) 
          return 
        } 
 
        // Verifica bloqueio por agendamento 
        const configResult = await client.query( 
          "SELECT valor FROM configuracoes WHERE chave = 'agendamento_bloqueio_ativo'" 
        ) 
        const bloqueioAtivo = configResult.rows[0]?.valor === 'true' 
 
        if (bloqueioAtivo) { 
          const minResult = await client.query( 
            "SELECT valor FROM configuracoes WHERE chave = 'agendamento_minutos_bloqueio'" 
          ) 
          const minBloqueio = parseInt(minResult.rows[0]?.valor || '60') 
 
          const agora = new Date() 
          const limiteBloqueio = new Date(agora.getTime() + minBloqueio * 60 * 1000) 
 
          const agendadaResult = await client.query(` 
            SELECT * FROM rides 
            WHERE driver_id = $1 
            AND tipo = 'agendada' 
            AND status IN ('aberta', 'aceita') 
            AND agendada_para <= $2 
            AND agendada_para >= $3 
            LIMIT 1 
          `, [driver.id, limiteBloqueio.toISOString(), agora.toISOString()]) 
          const corridaAgendada = agendadaResult.rows[0] 
 
          if (corridaAgendada) { 
            await client.query('ROLLBACK') 
            const horario = new Date(corridaAgendada.agendada_para).toLocaleString('pt-BR') 
            bot.answerCallbackQuery(callbackQuery.id, { 
              text: `Você tem um agendamento para ${horario}. Disponível após concluí-lo.`, 
              show_alert: true 
            }) 
            return 
          } 
        } 
 
        await client.query(` 
          UPDATE rides SET 
            status = 'aceita', 
            driver_id = $1, 
            aceita_at = CURRENT_TIMESTAMP 
          WHERE id = $2 
        `, [driver.id, rideId]) 
 
        await client.query('COMMIT') 
 
        bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Corrida aceita! Bom trabalho.' }) 
 
        // Atualiza mensagem no grupo 
        const textoGrupo = ` 
 ✅ *Corrida aceita!* 
 
 📍 Origem: ${ride.origem} 
 🏁 Destino: ${ride.destino} 
 💰 Valor: R$ ${Number(ride.valor).toFixed(2)} 
 
 🧑‍✈️ Motorista: *${driver.nome}* 
 🚗 ${driver.modelo_carro} ${driver.cor_carro} ${driver.ano_carro} — ${driver.placa} 
        `.trim() 
 
        bot.editMessageText(textoGrupo, { 
          chat_id: message.chat.id, 
          message_id: message.message_id, 
          parse_mode: 'Markdown' 
        }).catch(() => {}) 
 
        // Link da corrida e rota 
        const link = `${process.env.BASE_URL}/r/${ride.token}` 
 
        let clienteNome = 'Passageiro' 
        if (ride.client_id) { 
          const clientResult = await dbQuery('SELECT nome FROM clients WHERE id = $1', [ride.client_id]) 
          const client = clientResult.rows[0] 
          if (client?.nome) clienteNome = client.nome 
        } 
 
        const linkNavegar = (ride.origem_lat && ride.origem_lng) 
          ? `https://www.google.com/maps/dir/?api=1&destination=${ride.origem_lat},${ride.origem_lng}&travelmode=driving` 
          : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ride.origem)}&travelmode=driving` 
 
        const linkRota = (ride.origem_lat && ride.destino_lat) 
          ? `https://www.google.com/maps/dir/?api=1&origin=${ride.origem_lat},${ride.origem_lng}&destination=${ride.destino_lat},${ride.destino_lng}&travelmode=driving` 
          : `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(ride.origem)}&destination=${encodeURIComponent(ride.destino)}&travelmode=driving` 
 
        const msgMotorista = ` 
 🚗 *Corrida aceita! Bom trabalho!* 
 
 👤 Passageiro: *${clienteNome}* 
 📍 Origem: ${ride.origem} 
 🏁 Destino: ${ride.destino} 
 💰 Valor total: R$ ${Number(ride.valor).toFixed(2)} 
 👨‍✈️ Seu recebimento: R$ ${Number(ride.valor_motorista || ride.valor * 0.70).toFixed(2)} 
 
 ⚠️ Compartilhe sua localização ao vivo aqui no bot para o passageiro acompanhar você em tempo real. 
         `.trim() 
 
        bot.sendMessage(from.id, msgMotorista, { 
          parse_mode: 'Markdown', 
          reply_markup: { 
            inline_keyboard: [ 
              [ 
                { text: '🧭 Navegar até o passageiro', url: linkNavegar } 
              ], 
              [ 
                { text: '🗺️ Ver rota completa (origem → destino)', url: linkRota } 
              ] 
            ] 
          } 
        }).catch(() => { 
          console.warn(`[BOT] Motorista ${from.id} não iniciou o bot privado.`) 
        }) 
 
        // Manda link da corrida separado para ficar destacado 
        bot.sendMessage(from.id, 
          `📱 Link da corrida para o passageiro acompanhar:\n${link}`, 
          { parse_mode: 'Markdown' } 
        ).catch(() => {}) 
 
        // Busca token do perfil do motorista 
        const driverTokenResult = await dbQuery('SELECT token_perfil FROM drivers WHERE id = $1', [driver.id]) 
        const driverComToken = driverTokenResult.rows[0] 
        const linkPerfil = driverComToken?.token_perfil 
          ? `${process.env.BASE_URL}/motorista/${driverComToken.token_perfil}` 
          : null 
 
        if (linkPerfil) { 
          bot.sendMessage(from.id, 
            `👤 Seu perfil e avaliações:\n${linkPerfil}`, 
            { parse_mode: 'Markdown' } 
          ).catch(() => {}) 
        } 
 
        // Envia painel de controle da corrida ao motorista 
        bot.sendMessage(from.id, `🎛️ *Painel de controle da corrida #${ride.id}*\n\nUse os botões abaixo para gerenciar a corrida:`, { 
          parse_mode: 'Markdown', 
          reply_markup: { 
            inline_keyboard: [ 
              [{ text: '📍 Cheguei ao passageiro', callback_data: `chegou:${ride.id}` }], 
              [{ text: '🚶 Passageiro embarcou', callback_data: `embarcou:${ride.id}` }], 
              [{ text: '⏸️ Iniciar parada', callback_data: `parada_ini:${ride.id}` }], 
              [{ text: '▶️ Retomar corrida', callback_data: `parada_fim:${ride.id}` }], 
              [{ text: '✅ Finalizar corrida', callback_data: `finalizar:${ride.id}` }] 
            ] 
          } 
        }).catch(() => {}) 
 
      } catch (err) { 
        await client.query('ROLLBACK') 
        console.error('[BOT] Erro ao aceitar corrida:', err) 
        bot.answerCallbackQuery(callbackQuery.id, { 
          text: 'Erro interno ao aceitar corrida.', 
          show_alert: true 
        }) 
      } finally { 
        client.release() 
      } 
      return 
    } 
 
    // --- AVALIAÇÃO DO CLIENTE PELO MOTORISTA --- 
    if (data.startsWith('rate_client:')) { 
      const parts = data.split(':') 
      const rideId = parseInt(parts[1]) 
      const estrelas = parseInt(parts[2]) 
 
      try { 
        await fetch(`http://localhost:${process.env.PORT || 3000}/api/internal/rate-client`, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify({ 
            ride_id: rideId, 
            driver_telegram_id: from.id, 
            estrelas 
          }) 
        }) 
      } catch (e) { 
        console.error('[BOT] Erro ao registrar avaliação:', e) 
      } 
 
      bot.answerCallbackQuery(callbackQuery.id, { 
        text: `Avaliação registrada! Obrigado.`, 
        show_alert: false 
      }) 
 
      bot.editMessageText( 
        `✅ Você avaliou o passageiro com ${estrelas} estrela${estrelas > 1 ? 's' : ''}. Obrigado!`, 
        { chat_id: from.id, message_id: message.message_id } 
      ).catch(() => {}) 
 
      return 
    } 
 
    // CHEGOU AO PASSAGEIRO 
    if (data.startsWith('chegou:')) { 
      const rideId = parseInt(data.split(':')[1]) 
      const ride = (await dbQuery('SELECT * FROM rides WHERE id = $1', [rideId])).rows[0] 
      if (!ride) { bot.answerCallbackQuery(callbackQuery.id, { text: 'Corrida não encontrada', show_alert: true }); return } 
 
      await dbQuery(` 
        UPDATE rides SET 
          status_detalhe = 'aguardando_passageiro', 
          motorista_chegou_at = CURRENT_TIMESTAMP 
        WHERE id = $1 AND motorista_chegou_at IS NULL 
      `, [rideId]) 
 
      bot.answerCallbackQuery(callbackQuery.id, { text: '📍 Chegada registrada! Timer iniciado.', show_alert: true }) 
 
      bot.sendMessage(from.id, 
        `📍 *Chegada registrada!*\n\n⏱️ Você tem 5 minutos grátis de espera.\nApós isso: R$ 0,60/min\n\nSe o passageiro não aparecer em 10 minutos, você pode cancelar.`, 
        { parse_mode: 'Markdown' } 
      ).catch(() => {}) 
      return 
    } 
 
    // PASSAGEIRO EMBARCOU 
    if (data.startsWith('embarcou:')) { 
      const rideId = parseInt(data.split(':')[1]) 
      const ride = (await dbQuery('SELECT * FROM rides WHERE id = $1', [rideId])).rows[0] 
      if (!ride) { bot.answerCallbackQuery(callbackQuery.id, { text: 'Corrida não encontrada', show_alert: true }); return } 
      if (!ride.motorista_chegou_at) { bot.answerCallbackQuery(callbackQuery.id, { text: 'Registre chegada primeiro!', show_alert: true }); return } 
 
      const { calcularTempoMinutos, calculateInitialWaitCost } = await import('./billing.js') 
      const configs = (await dbQuery('SELECT chave, valor FROM configuracoes')).rows 
      const config = {} 
      configs.forEach(c => config[c.chave] = c.valor) 
 
      const tempoEspera = calcularTempoMinutos(ride.motorista_chegou_at) 
      const custoEspera = calculateInitialWaitCost(tempoEspera, config) 
 
      await dbQuery(` 
        UPDATE rides SET 
          status_detalhe = 'em_andamento', 
          passageiro_embarcou_at = CURRENT_TIMESTAMP, 
          tempo_espera_inicial_min = $1, 
          custo_espera_inicial = $2 
        WHERE id = $3 
      `, [tempoEspera, custoEspera, rideId]) 
 
      const msg = custoEspera > 0 
        ? `🚶 *Passageiro embarcou!*\n\n⏱️ Espera: ${tempoEspera.toFixed(1)} min\n💰 Custo espera: R$ ${custoEspera.toFixed(2)}\n\nCorrida iniciada! Bom trajeto!` 
        : `🚶 *Passageiro embarcou!*\n\n⏱️ Espera: ${tempoEspera.toFixed(1)} min (dentro do grátis)\n\nCorrida iniciada! Bom trajeto!` 
 
      bot.answerCallbackQuery(callbackQuery.id, { text: 'Corrida iniciada!' }) 
      bot.sendMessage(from.id, msg, { parse_mode: 'Markdown' }).catch(() => {}) 
      return 
    } 
 
    // INICIAR PARADA 
    if (data.startsWith('parada_ini:')) { 
      const rideId = parseInt(data.split(':')[1]) 
 
      const paradaAberta = (await dbQuery( 
        'SELECT id FROM ride_stops WHERE ride_id = $1 AND finalizada_at IS NULL', [rideId] 
      )).rows[0] 
 
      if (paradaAberta) { 
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Já existe uma parada em andamento!', show_alert: true }) 
        return 
      } 
 
      const result = await dbQuery('INSERT INTO ride_stops (ride_id) VALUES ($1) RETURNING id', [rideId]) 
      await dbQuery(`UPDATE rides SET status_detalhe = 'em_parada', num_paradas = num_paradas + 1 WHERE id = $1`, [rideId]) 
 
      bot.answerCallbackQuery(callbackQuery.id, { text: '⏸️ Parada iniciada! 2 min grátis.', show_alert: true }) 
      bot.sendMessage(from.id, 
        `⏸️ *Parada iniciada*\n\n⏱️ 2 minutos grátis\nApós isso: R$ 0,60/min\n\nClique em "▶️ Retomar corrida" quando continuar.`, 
        { 
          parse_mode: 'Markdown', 
          reply_markup: { 
            inline_keyboard: [[ 
              { text: '▶️ Retomar corrida', callback_data: `parada_fim:${rideId}:${result.rows[0].id}` } 
            ]] 
          } 
        } 
      ).catch(() => {}) 
      return 
    } 
 
    // FINALIZAR PARADA 
    if (data.startsWith('parada_fim:')) { 
      const parts = data.split(':') 
      const rideId = parseInt(parts[1]) 
      const stopId = parts[2] ? parseInt(parts[2]) : null 
 
      const stop = (await dbQuery( 
        'SELECT * FROM ride_stops WHERE ride_id = $1 AND finalizada_at IS NULL ORDER BY iniciada_at DESC LIMIT 1', 
        [rideId] 
      )).rows[0] 
 
      if (!stop) { 
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Nenhuma parada em andamento', show_alert: true }) 
        return 
      } 
 
      const { calcularTempoMinutos, calculateStopCost } = await import('./billing.js') 
      const configs = (await dbQuery('SELECT chave, valor FROM configuracoes')).rows 
      const config = {} 
      configs.forEach(c => config[c.chave] = c.valor) 
 
      const duracao = calcularTempoMinutos(stop.iniciada_at) 
      const custo = calculateStopCost(duracao, config) 
 
      await dbQuery(` 
        UPDATE ride_stops SET finalizada_at = CURRENT_TIMESTAMP, duracao_min = $1, custo = $2 WHERE id = $3 
      `, [duracao, custo, stop.id]) 
 
      const totalParadas = (await dbQuery( 
        'SELECT COALESCE(SUM(custo), 0) as total, COALESCE(SUM(duracao_min), 0) as tempo FROM ride_stops WHERE ride_id = $1', 
        [rideId] 
      )).rows[0] 
 
      await dbQuery(` 
        UPDATE rides SET status_detalhe = 'em_andamento', custo_paradas = $1, tempo_paradas_total_min = $2 WHERE id = $3 
      `, [totalParadas.total, totalParadas.tempo, rideId]) 
 
      bot.answerCallbackQuery(callbackQuery.id, { text: '▶️ Corrida retomada!', show_alert: true }) 
      bot.sendMessage(from.id, 
        `▶️ *Corrida retomada!*\n\n⏱️ Parada: ${duracao.toFixed(1)} min\n💰 Custo: R$ ${custo.toFixed(2)}\n\nBom trajeto!`, 
        { parse_mode: 'Markdown' } 
      ).catch(() => {}) 
      return 
    } 
 
    // FINALIZAR CORRIDA 
    if (data.startsWith('finalizar:')) { 
      const rideId = parseInt(data.split(':')[1]) 
      const ride = (await dbQuery('SELECT * FROM rides WHERE id = $1', [rideId])).rows[0] 
      if (!ride) { bot.answerCallbackQuery(callbackQuery.id, { text: 'Corrida não encontrada', show_alert: true }); return } 
 
      const { calculateTotalRideCost } = await import('./billing.js') 
      const configs = (await dbQuery('SELECT chave, valor FROM configuracoes')).rows 
      const config = {} 
      configs.forEach(c => config[c.chave] = c.valor) 
 
      const valorFinal = calculateTotalRideCost( 
        ride.valor || 0, 
        ride.custo_espera_inicial || 0, 
        ride.custo_paradas || 0, 
        config 
      ) 
      const valorMotorista = parseFloat((valorFinal * 0.70).toFixed(2)) 
 
      await dbQuery(` 
        UPDATE rides SET 
          status = 'concluida', 
          concluida_at = CURRENT_TIMESTAMP, 
          valor_final = $1 
        WHERE id = $2 
      `, [valorFinal, rideId]) 
 
      // Atualiza contadores 
      if (ride.driver_id) { 
        await dbQuery('UPDATE drivers SET total_viagens = total_viagens + 1 WHERE id = $1', [ride.driver_id]) 
      } 
      if (ride.client_id) { 
        await dbQuery('UPDATE clients SET total_corridas = total_corridas + 1 WHERE id = $1', [ride.client_id]) 
      } 
 
      // Edita mensagem no grupo 
      if (ride.telegram_message_id) { 
        await editGroupMessage( 
          ride.telegram_message_id, 
          `✅ *Corrida concluída!*\n\n📍 ${ride.origem}\n🏁 ${ride.destino}\n💰 Valor final: R$ ${valorFinal.toFixed(2)}` 
        ) 
      } 
 
      // Notifica motorista para avaliar 
      const driver = (await dbQuery('SELECT * FROM drivers WHERE id = $1', [ride.driver_id])).rows[0] 
      if (driver) await notifyDriverRateClient(driver, ride) 
 
      bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Corrida finalizada!', show_alert: true }) 
      bot.sendMessage(from.id, ` 
 ✅ *Corrida finalizada!* 
 
 💰 Valor base: R$ ${Number(ride.valor).toFixed(2)} 
 ⏱️ Custo espera: R$ ${Number(ride.custo_espera_inicial || 0).toFixed(2)} 
 ⏸️ Custo paradas: R$ ${Number(ride.custo_paradas || 0).toFixed(2)} 
 ━━━━━━━━━━━━━━━ 
 💵 *Valor final: R$ ${valorFinal.toFixed(2)}* 
 👨‍✈️ *Seu recebimento: R$ ${valorMotorista.toFixed(2)}* 
 
 Obrigado pelo serviço! 
   `.trim(), { parse_mode: 'Markdown' }).catch(() => {}) 
      return 
    } 
  }) 
 
  console.log('[BOT] Telegram bot iniciado com polling') 
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
 
  // Busca motoristas online 
  const motoristasOnline = (await dbQuery( 
    'SELECT COUNT(*) as total FROM drivers WHERE ativo = 1 AND online = 1 AND status_cadastro = $1', 
    ['aprovado'] 
  )).rows[0] 
 
  const qtdOnline = parseInt(motoristasOnline?.total || 0) 
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
