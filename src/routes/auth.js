import bcrypt from 'bcrypt' 
import { query, pool } from '../db.js' 
 
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
}
