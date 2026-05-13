import bcrypt from 'bcrypt' 
import { query, pool } from '../db.js' 
import { requireAuth } from '../middleware/auth.js' 

export default async function authRoutes(fastify) { 

  fastify.post('/api/login', async (request, reply) => { 
    const { email, senha } = request.body 

    if (!email || !senha) { 
      return reply.code(400).send({ error: 'Email e senha obrigatórios' }) 
    } 

    const result = await query('SELECT * FROM admins WHERE email = $1', [email]) 
    const admin = result.rows[0] 

    if (!admin) { 
      return reply.code(401).send({ error: 'Credenciais inválidas' }) 
    } 

    const ok = await bcrypt.compare(senha, admin.senha_hash) 
    if (!ok) { 
      return reply.code(401).send({ error: 'Credenciais inválidas' }) 
    } 

    const token = fastify.jwt.sign( 
      { id: admin.id, email: admin.email }, 
      { expiresIn: '8h' } 
    ) 

    return { token } 
  }) 
  
  fastify.post('/api/login/verify', async (request, reply) => {
    try {
      await request.jwtVerify()
      return reply.code(200).send({ ok: true })
    } catch(e) {
      return reply.code(401).send({ error: 'Invalid token' })
    }
  })

  // Rotas de configurações
  fastify.get('/api/configuracoes', { preHandler: requireAuth }, async () => {
    const configs = (await query('SELECT chave, valor FROM configuracoes')).rows
    const obj = {}
    configs.forEach(c => obj[c.chave] = c.valor)
    return obj
  })

  fastify.put('/api/configuracoes', { preHandler: requireAuth }, async (request, reply) => {
    const updates = request.body
    for (const [chave, valor] of Object.entries(updates)) {
      await query(
        'INSERT INTO configuracoes (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor',
        [chave, String(valor)]
      )
    }
    return { mensagem: 'Configurações salvas com sucesso!' }
  })
}
