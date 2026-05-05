import TelegramBot from 'node-telegram-bot-api' 
import { db } from './db.js' 
 
let bot 
 
export function initBot() { 
  bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { 
    polling: true, 
    baseApiUrl: 'https://api.telegram.org' 
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
 
        console.log('[DEBUG] from.id:', from.id) 
        console.log('[DEBUG] String(from.id):', String(from.id)) 
 
        let driver = db.prepare( 
          'SELECT * FROM drivers WHERE telegram_id = ? AND ativo = 1' 
        ).get(String(from.id)) 
 
        if (!driver) { 
          driver = db.prepare( 
            'SELECT * FROM drivers WHERE CAST(telegram_id AS TEXT) = ? AND ativo = 1' 
          ).get(String(from.id)) 
        } 
 
        console.log('[DEBUG] driver encontrado:', driver) 
 
        if (!driver) { 
          const todos = db.prepare('SELECT id, nome, telegram_id FROM drivers WHERE ativo = 1').all() 
          console.log('[DEBUG] Motoristas ativos no banco:', todos) 
          return null 
        } 
 
        // --- VERIFICAÇÃO DE BLOQUEIO POR AGENDAMENTO --- 
        const bloqueioAtivo = db.prepare( 
          "SELECT valor FROM configuracoes WHERE chave = 'agendamento_bloqueio_ativo'" 
        ).get()?.valor === 'true' 
 
        if (bloqueioAtivo) { 
          const minBloqueio = parseInt(db.prepare( 
            "SELECT valor FROM configuracoes WHERE chave = 'agendamento_minutos_bloqueio'" 
          ).get()?.valor || '60') 
 
          const agora = new Date() 
          const limiteBloquio = new Date(agora.getTime() + minBloqueio * 60 * 1000) 
 
          const corridaAgendada = db.prepare(` 
            SELECT * FROM rides 
            WHERE driver_id = ? 
            AND tipo = 'agendada' 
            AND status IN ('aberta', 'aceita') 
            AND agendada_para <= ? 
            AND agendada_para >= ? 
          `).get(driver.id, limiteBloquio.toISOString(), agora.toISOString()) 
 
          if (corridaAgendada) { 
            const horario = new Date(corridaAgendada.agendada_para).toLocaleString('pt-BR') 
            bot.answerCallbackQuery(query.id, { 
              text: `Você tem uma corrida agendada para ${horario}. Disponível após concluí-la.`, 
              show_alert: true 
            }) 
            return { blocked: true } 
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
 
      if (result.blocked) return 
 
      const { ride, driver } = result 
 
      bot.answerCallbackQuery(query.id, { text: 'Corrida aceita! Bom trabalho.' }) 
 
      const textoGrupo = ` 
✅ *Corrida aceita!* 
 
📍 Origem: ${ride.origem} 
🏁 Destino: ${ride.destino} 
💰 Valor: R$ ${ride.valor.toFixed(2)} 
 
🧑‍✈️ Motorista: *${driver.nome}* 
🚗 ${driver.modelo_carro} ${driver.cor_carro} ${driver.ano_carro} — ${driver.placa} 
      `.trim() 
 
      bot.editMessageText(textoGrupo, { 
        chat_id: message.chat.id, 
        message_id: message.message_id, 
        parse_mode: 'Markdown' 
      }).catch(() => {}) 
 
      const link = `${process.env.BASE_URL}/r/${ride.token}` 
      bot.sendMessage(from.id, 
        `🚗 Você aceitou a corrida!\n\n📍 ${ride.origem}\n🏁 ${ride.destino}\n\nAbra o Google Maps, compartilhe sua localização ao vivo e envie o link aqui.\n\n🔗 Link da corrida para o cliente:\n${link}`, 
        { parse_mode: 'Markdown' } 
      ).catch(() => { 
        console.warn(`[BOT] Motorista ${from.id} não iniciou o bot privado.`) 
      }) 
 
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
  const valorMotorista = ride.valor_motorista 
    ? `R$ ${Number(ride.valor_motorista).toFixed(2)}` 
    : `R$ ${(ride.valor * 0.70).toFixed(2)}` 
  
  const valorTotal = `R$ ${Number(ride.valor).toFixed(2)}` 

  const texto = ` 
🚗 *Nova corrida disponível!* 

📍 Origem: ${ride.origem} 
🏁 Destino: ${ride.destino} 

💰 Valor total: ${valorTotal} 
👨‍✈️ Seu recebimento (70%): *${valorMotorista}* 
  `.trim() 

  const msg = await bot.sendMessage(process.env.TELEGRAM_GROUP_ID, texto, { 
    parse_mode: 'Markdown', 
    reply_markup: { 
      inline_keyboard: [[ 
        { text: '✅ Aceitar corrida', callback_data: `accept:${ride.id}` } 
      ]] 
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
