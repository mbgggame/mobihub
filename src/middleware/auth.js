export async function requireAuth(request, reply) { 
  try { 
    await request.jwtVerify() 
  } catch (err) { 
    reply.code(401).send({ error: 'Não autorizado' }) 
  } 
}

export function sanitizar(str) {
  if (typeof str !== 'string') return str
  return str
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim()
    .substring(0, 1000)
}
