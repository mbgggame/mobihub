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

const __dirname = dirname(fileURLToPath(import.meta.url)) 

let ioInstance = null 

export function getIo() { 
  return ioInstance 
} 

const fastify = Fastify({ logger: true }) 

await fastify.register(fastifyCors, { 
   origin: true, 
   methods: ['GET', 'POST', 'OPTIONS'], 
   allowedHeaders: ['Content-Type', 'Authorization'] 
 }) 
await fastify.register(fastifyFormbody) 
await fastify.register(fastifyJwt, { secret: process.env.JWT_SECRET }) 

fastify.setErrorHandler((error, request, reply) => { 
  console.log('[ERRO GLOBAL FASTIFY]:', error) 
  reply.code(error.statusCode || 500).send({ error: error.message }) 
}) 

// Rotas API 
await fastify.register(authRoutes) 
await fastify.register(driversRoutes) 
await fastify.register(ridesRoutes) 
await fastify.register(publicRoutes) 

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
fastify.get('/solicitar', (req, reply) => reply.sendFile('solicitar/index.html')) 
fastify.get('/quero-dirigir', (req, reply) => reply.sendFile('cadastro-geral.html')) 
fastify.get('/r/:token', (req, reply) => reply.sendFile('ride/index.html')) 
fastify.get('/motorista/:token', (req, reply) => reply.sendFile('motorista/index.html')) 
fastify.get('/cadastro-motorista/:token', (req, reply) => reply.sendFile('cadastro-motorista/index.html')) 
fastify.get('/favicon.ico', (req, reply) => reply.code(204).send()) 

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
