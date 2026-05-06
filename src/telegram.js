import TelegramBot from 'node-telegram-bot-api' 
import { query, pool } from './db.js' 
import { db } from './db.js' 
 
let bot 
 
export function initBot() { 
  bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true }) 
 
  // Recebe localização ao vivo do motorista 
  bot.on('location', (msg) => { 
    const { lat, lng } = { lat: msg.location.latitude, lng: msg.location.longitude } 
    const telegramId = String(msg.from.id) 
 
    const driver = db.prepare('SELECT * FROM drivers WHERE telegram_id = ? AND ativo = 1').get(telegramId) 
    if (!driver) return 
 
    // Busca corrida ativa do motorista 
    const ride = db.prepare(` 
      SELECT * FROM rides 
      WHERE driver_id = ? AND status = 'aceita' 
      ORDER BY aceita_at DESC LIMIT 1 
    `).get(driver.id) 
 
    if (!ride) return 
 
    // Salva ou atualiza localização 
    const existing = db.prepare('SELECT id FROM driver_locations WHERE ride_id = ?').get(ride.id) 
    if (existing) { 
      db.prepare(` 
        UPDATE driver_locations SET lat = ?, lng = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE ride_id = ? 
      `).run(lat, lng, ride.id) 
    } else { 
      db.prepare(` 
        INSERT INTO driver_locations (driver_id, ride_id, lat, lng) 
        VALUES (?, ?, ?, ?) 
      `).run(driver.id, ride.id, lat, lng) 
    } 
  }) 
 
  bot.on('callback_query', async (query) => { 
    const { data, from, message } = query 
 
    // --- ACEITE DE CORRIDA --- 
    if (data.startsWith('accept:')) { 
      const rideId = parseInt(data.split(':')[1]) 
 
      const accept = db.transaction(() => { 
        const ride = db.prepare( 
          "SELECT * FROM rides WHERE id = ? AND status = 'aberta'" 
        ).get(rideId) 
        if (!ride) return null 
 
        let driver = db.prepare( 
          'SELECT * FROM drivers WHERE telegram_id = ? AND ativo = 1' 
        ).get(String(from.id)) 
 
        if (!driver) { 
          driver = db.prepare( 
            'SELECT * FROM drivers WHERE CAST(telegram_id AS TEXT) = ? AND ativo = 1' 
          ).get(String(from.id)) 
        } 
 
        if (!driver) return null 
 
        // Verifica bloqueio por agendamento 
        const bloqueioAtivo = db.prepare( 
          "SELECT valor FROM configuracoes WHERE chave = 'agendamento_bloqueio_ativo'" 
        ).get()?.valor === 'true' 
 
        if (bloqueioAtivo) { 
          const minBloqueio = parseInt(db.prepare( 
            "SELECT valor FROM configuracoes WHERE chave = 'agendamento_minutos_bloqueio'" 
          ).get()?.valor || '60') 
 
          const agora = new Date() 
          const limiteBloqueio = new Date(agora.getTime() + minBloqueio * 60 * 1000) 
 
          const corridaAgendada = db.prepare(` 
            SELECT * FROM rides 
            WHERE driver_id = ? 
            AND tipo = 'agendada' 
            AND status IN ('aberta', 'aceita') 
            AND agendada_para <= ? 
            AND agendada_para >= ? 
          `).get(driver.id, limiteBloqueio.toISOString(), agora.toISOString()) 
 
          if (corridaAgendada) { 
            return { bloqueado: true, horario: corridaAgendada.agendada_para } 
          } 
        } 
 
        db.prepare(` 
          UPDATE rides SET 
            status = 'aceita', 
            driver_id = ?, 
            aceita_at = CURRENT_TIMESTAMP 
          WHERE id = ? 
        `).run(driver.id, rideId) 
 
        return { ride, driver } 
      }) 
 
      const result = accept() 
 
      if (!result) { 
        bot.answerCallbackQuery(query.id, { 
          text: 'Corrida já foi aceita ou não disponível.', 
          show_alert: true 
        }) 
        return 
      } 
 
      if (result.bloqueado) { 
        const horario = new Date(result.horario).toLocaleString('pt-BR') 
        bot.answerCallbackQuery(query.id, { 
          text: `Você tem um agendamento para ${horario}. Disponível após concluí-lo.`, 
          show_alert: true 
        }) 
        return 
      } 
 
      const { ride, driver } = result 
      bot.answerCallbackQuery(query.id, { text: '✅ Corrida aceita! Bom trabalho.' }) 
 
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
 
      const mapsLink = (ride.origem_lat && ride.destino_lat) 
        ? `https://www.google.com/maps/dir/?api=1&origin=${ride.origem_lat},${ride.origem_lng}&destination=${ride.destino_lat},${ride.destino_lng}&travelmode=driving` 
        : `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(ride.origem)}&destination=${encodeURIComponent(ride.destino)}&travelmode=driving` 
 
      const msgMotorista = ` 
 🚗 *Corrida aceita! Bom trabalho!* 
 
 📍 Origem: ${ride.origem} 
 🏁 Destino: ${ride.destino} 
 💰 Valor total: R$ ${Number(ride.valor).toFixed(2)} 
 👨‍✈️ Seu recebimento: R$ ${Number(ride.valor_motorista || ride.valor * 0.70).toFixed(2)} 
 
 ⚠️ *IMPORTANTE: Compartilhe sua localização ao vivo aqui no bot para o passageiro acompanhar você em tempo real.* 
 
 Como compartilhar: 
 1️⃣ Clique no 📎 (clipe) 
 2️⃣ Toque em Localização 
 3️⃣ Selecione "Compartilhar localização ao vivo" 
 4️⃣ Escolha 1 hora e confirme 
       `.trim() 
 
      bot.sendMessage(from.id, msgMotorista, { 
        parse_mode: 'Markdown', 
        reply_markup: { 
          inline_keyboard: [[ 
            { text: '🗺️ Abrir rota no Google Maps', url: mapsLink } 
          ]] 
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
      const driverComToken = db.prepare('SELECT token_perfil FROM drivers WHERE id = ?').get(driver.id) 
      const linkPerfil = driverComToken?.token_perfil 
        ? `${process.env.BASE_URL}/motorista/${driverComToken.token_perfil}` 
        : null 
 
      if (linkPerfil) { 
        bot.sendMessage(from.id, 
          `👤 Seu perfil e avaliações:\n${linkPerfil}`, 
          { parse_mode: 'Markdown' } 
        ).catch(() => {}) 
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
 
      bot.answerCallbackQuery(query.id, { 
        text: `Avaliação registrada! Obrigado.`, 
        show_alert: false 
      }) 
 
      bot.editMessageText( 
        `✅ Você avaliou o passageiro com ${estrelas} estrela${estrelas > 1 ? 's' : ''}. Obrigado!`, 
        { chat_id: from.id, message_id: message.message_id } 
      ).catch(() => {}) 
 
      return 
    } 
  }) 
 
  console.log('[BOT] Telegram bot iniciado com polling') 
} 
 
export async function sendRideToGroup(ride) { 
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
 
  // Busca dados do passageiro 
  let infoPassageiro = '' 
  if (ride.client_id) { 
    const client = db.prepare('SELECT nome, media_avaliacao, total_avaliacoes FROM clients WHERE id = ?').get(ride.client_id) 
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
