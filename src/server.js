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
fastify.get('/', (req, reply) => reply.redirect('/admin')) 
fastify.get('/login', (req, reply) => reply.redirect('/admin/login')) 
fastify.get('/admin', (req, reply) => reply.sendFile('admin/index.html')) 
fastify.get('/admin/dashboard', (req, reply) => reply.sendFile('admin/dashboard.html')) 
fastify.get('/admin/login', (req, reply) => reply.sendFile('admin/login.html')) 
fastify.get('/admin/nova-corrida', (req, reply) => reply.sendFile('admin/nova-corrida.html')) 
fastify.get('/admin/motoristas', (req, reply) => reply.sendFile('admin/motoristas.html')) 
fastify.get('/admin/tarifas', (req, reply) => reply.sendFile('admin/tarifas.html')) 
fastify.get('/admin/reputacao', (req, reply) => reply.sendFile('admin/reputacao.html'))
fastify.get('/admin/configuracoes', (req, reply) => reply.sendFile('admin/configuracoes.html')) 
fastify.get('/solicitar', (req, reply) => reply.sendFile('solicitar/index.html')) 
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

// Configura webhook após iniciar 
fastify.addHook('onReady', async () => { 
  const isProduction = process.env.BASE_URL && !process.env.BASE_URL.includes('localhost') 
  if (isProduction) { 
    const { getBot } = await import('./telegram.js') 
    const bot = getBot() 
    const webhookUrl = `${process.env.BASE_URL}/webhook/telegram` 
    await bot.setWebHook(webhookUrl) 
    console.log('[BOT] Webhook configurado:', webhookUrl) 
  } 
}) 
 
// Inicializa 
await initDB() 
initBot() 
initScheduler() 
 
const port = parseInt(process.env.PORT || '3000') 
try {
  await fastify.listen({ port, host: '0.0.0.0' }) 
  console.log(`[SERVER] MobiHub rodando em http://localhost:${port}`)
} catch (err) {
  console.error('[ERRO DE INICIALIZAÇÃO RENDER]:', err)
  process.exit(1)
}

// Inicializa Socket.IO
const io = new Server(fastify.server, { cors: { origin: '*' } }); 
io.on('connection', (socket) => { 
  socket.on('motorista:posicao', (data) => { 
    // data = { rideId, lat, lng } 
    socket.broadcast.to(`ride:${data.rideId}`).emit('motorista:posicao', data); 
  }); 
  socket.on('entrar:corrida', (rideId) => { 
    socket.join(`ride:${rideId}`); 
  }); 
}); 
