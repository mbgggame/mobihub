import 'dotenv/config' 
import Fastify from 'fastify' 
import fastifyJwt from '@fastify/jwt' 
import fastifyStatic from '@fastify/static' 
import fastifyCors from '@fastify/cors' 
import fastifyFormbody from '@fastify/formbody' 
import { join, dirname } from 'path' 
import { fileURLToPath } from 'url' 
import { Server } from 'socket.io' 

import { initDB } from './db.js' 
import { initBot } from './telegram.js' 
import { initScheduler } from './scheduler.js' 
import authRoutes from './routes/auth.js'
import driversRoutes from './routes/drivers.js'
import ridesRoutes from './routes/rides.js'
import publicRoutes from './routes/public.js'
import integracoesRoutes from './routes/integracoes.js'
import agendamentosRoutes from './routes/agendamentos.js'
import adminDbRoutes from './routes/admin-db.js'
import indicacoesRoutes from './routes/indicacoes.js'

const __dirname = dirname(fileURLToPath(import.meta.url)) 

let ioInstance = null 

export function getIo() { 
  return ioInstance 
}
 

const fastify = Fastify({ logger: true, bodyLimit: 10485760 }) 

await fastify.register(fastifyCors, { 
   origin: true, 
   methods: ['GET', 'POST', 'OPTIONS'], 
   allowedHeaders: ['Content-Type', 'Authorization'] 
 }) 

await fastify.register(fastifyFormbody) 
await fastify.register(fastifyJwt, { secret: process.env.JWT_SECRET })

// === SEGURANÇA ===

// Headers de segurança HTTP
fastify.addHook('onSend', async (request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'DENY')
  reply.header('X-XSS-Protection', '1; mode=block')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Permissions-Policy', 'geolocation=(), microphone=()')
  return payload
})

// Rate limiting manual por IP
const ipRequests = new Map()
fastify.addHook('onRequest', async (request, reply) => {
  const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip
  const agora = Date.now()
  const janela = 60000 // 1 minuto
  
  // Rotas de polling não contam no rate limit
  const rotasExcluidas = ['/api/motorista/', '/api/ride/', '/api/motoristas-online']
  const isPolling = rotasExcluidas.some(r => request.url.includes(r))
  if (isPolling) return

  const limite = request.url === '/api/login' ? 5 : 300

  if (!ipRequests.has(ip)) ipRequests.set(ip, [])
  const reqs = ipRequests.get(ip).filter(t => agora - t < janela)
  reqs.push(agora)
  ipRequests.set(ip, reqs)

  if (reqs.length > limite) {
    return reply.code(429).send({
      error: 'Too Many Requests',
      message: 'Muitas requisições. Tente novamente em 1 minuto.'
    })
  }
})

// Limpa o mapa de IPs a cada 5 minutos
setInterval(() => {
  const agora = Date.now()
  for (const [ip, reqs] of ipRequests.entries()) {
    const recentes = reqs.filter(t => agora - t < 60000)
    if (recentes.length === 0) ipRequests.delete(ip)
    else ipRequests.set(ip, recentes)
  }
}, 300000)

fastify.setErrorHandler((error, request, reply) => { 
  console.log('[ERRO GLOBAL FASTIFY]:', error) 
  reply.code(error.statusCode || 500).send({ error: error.message }) 
}) 

// Rotas API
await fastify.register(authRoutes)
await fastify.register(driversRoutes)
await fastify.register(ridesRoutes)
await fastify.register(publicRoutes)
await fastify.register(integracoesRoutes)
await fastify.register(agendamentosRoutes)
await fastify.register(adminDbRoutes)
await fastify.register(indicacoesRoutes) 

await fastify.register(fastifyStatic, { 
  root: join(__dirname, '..', 'public'), 
  prefix: '/' 
}) 

// Rotas HTML 
fastify.get('/', (req, reply) => reply.sendFile('index.html')) 
fastify.get('/login', (req, reply) => reply.redirect('/admin/login')) 
fastify.get('/admin', (req, reply) => reply.sendFile('admin/index.html')) 
fastify.get('/admin/dashboard', (req, reply) => reply.sendFile('admin/dashboard.html')) 
fastify.get('/admin/login', (req, reply) => reply.sendFile('admin/login.html')) 
fastify.get('/admin/nova-corrida', (req, reply) => reply.sendFile('admin/nova-corrida.html')) 
fastify.get('/admin/motoristas', (req, reply) => reply.sendFile('admin/motoristas.html')) 
fastify.get('/admin/passageiros', (req, reply) => reply.sendFile('admin/passageiros.html')) 
fastify.get('/admin/tarifas', (req, reply) => reply.sendFile('admin/tarifas.html')) 
fastify.get('/admin/reputacao', (req, reply) => reply.sendFile('admin/reputacao.html')) 
fastify.get('/admin/configuracoes', (req, reply) => reply.sendFile('admin/configuracoes.html')) 
fastify.get('/admin/integracoes', (req, reply) => reply.sendFile('admin/integracoes.html')) 
fastify.get('/admin/relatorios', (req, reply) => reply.sendFile('admin/relatorios.html'))
fastify.get('/admin/kepler', (req, reply) => reply.sendFile('admin/kepler.html'))
fastify.get('/admin/indicacoes', (req, reply) => reply.sendFile('admin/indicacoes.html'))
fastify.get('/admin/operacional', (req, reply) => reply.sendFile('admin/operacional.html')) 
fastify.get('/solicitar', (req, reply) => reply.sendFile('solicitar/index.html')) 
fastify.get('/cadastro', (req, reply) => reply.redirect('/solicitar' + (req.query.ref ? `?ref=${req.query.ref}` : ''))) 
fastify.get('/quero-dirigir', (req, reply) => reply.sendFile('cadastro-geral.html')) 
fastify.get('/r/:token', (req, reply) => reply.sendFile('ride/index.html')) 
fastify.get('/motorista/:token', (req, reply) => reply.sendFile('motorista/index.html')) 
fastify.get('/cadastro-motorista/:token', (req, reply) => reply.sendFile('cadastro-motorista/index.html'))
fastify.get('/favicon.ico', (req, reply) => reply.code(204).send())
fastify.get('/download', (req, reply) => reply.sendFile('download.html'))
fastify.get('/apk/passageiro', async (request, reply) => {
  return reply.sendFile('MobiHub-Passageiro.apk')
})
fastify.get('/apk/motorista', async (request, reply) => {
  return reply.sendFile('MobiHub-Motorista.apk')
}) 

// Webhook do Telegram 
fastify.post('/webhook/telegram', async (request, reply) => { 
  const { getBot } = await import('./telegram.js') 
  const bot = getBot() 
  if (bot) bot.processUpdate(request.body) 
  return { ok: true } 
}) 

// Inicializa 
await initDB() 
initBot() 
initScheduler() 

// Inicializa Socket.IO (antes de listen!) 
ioInstance = new Server(fastify.server, { cors: { origin: '*' } }); 
ioInstance.on('connection', (socket) => { 
  socket.on('motorista:posicao', (data) => {
    socket.broadcast.to(`ride:${data.rideId}`).emit('motorista:posicao', data);
  });
  socket.on('entrar:corrida', (rideId) => {
    socket.join(`ride:${rideId}`);
  });
  socket.on('entrar:motorista', (driverId) => {
    socket.join(`motorista:${driverId}`);
  }); 
}); 

const port = parseInt(process.env.PORT || '3000') 
try { 
  // 1. Inicia o servidor primeiro para evitar timeout no Render 
  await fastify.listen({ port, host: '0.0.0.0' }) 
  console.log(`[SERVER] MobiHub rodando em http://localhost:${port}`) 

  // 2. Configura o Telegram de forma assíncrona após o servidor estar online 
  const isProduction = process.env.BASE_URL && !process.env.BASE_URL.includes('localhost') 
  if (isProduction) { 
    import('./telegram.js').then(({ getBot }) => { 
      const bot = getBot() 
      if (bot) { 
        const webhookUrl = `${process.env.BASE_URL}/webhook/telegram` 
        bot.setWebHook(webhookUrl) 
          .then(() => console.log('[BOT] Webhook configurado com sucesso:', webhookUrl)) 
          .catch(e => console.error('[BOT ERROR] Falha ao configurar Webhook:', e.message)) 
      } 
    }).catch(e => console.error('[BOT ERROR] Falha ao importar telegram.js:', e.message)) 
  } 
} catch (err) { 
  console.error('[ERRO DE INICIALIZAÇÃO RENDER]:', err) 
  process.exit(1) 
}
