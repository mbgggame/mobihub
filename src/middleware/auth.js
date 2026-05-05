export async function requireAuth(request, reply) { 
  try { 
    await request.jwtVerify() 
  } catch (err) { 
    reply.code(401).send({ error: 'Não autorizado' }) 
  } 
}
