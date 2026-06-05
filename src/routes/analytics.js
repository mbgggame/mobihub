import { query } from '../db.js'

export default async function analyticsRoutes(fastify) {
  // GET /api/analytics/demanda-vix
  fastify.get('/demanda-vix', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['chegada', 'partida', 'ambos'], default: 'ambos' }
        }
      }
    }
  }, async (request, reply) => {
    const { tipo = 'ambos' } = request.query

    let sqlMatriz = `
      SELECT dia_semana, hora_slot, pax_estimado, tipo, operator_iata
      FROM flight_history
      WHERE horario_bsb IS NOT NULL AND pax_estimado IS NOT NULL
    `
    const paramsMatriz = []

    if (tipo !== 'ambos') {
      sqlMatriz += ' AND tipo = $1'
      paramsMatriz.push(tipo)
    }

    const { rows: rowsMatriz } = await query(sqlMatriz, paramsMatriz)
    
    let sqlDetalhe = `
      SELECT 
        dia_semana, hora_slot, tipo, ident, operator, operator_iata,
        aircraft_type, pax_estimado, origem_iata, destino_iata 
      FROM flight_history 
      WHERE pax_estimado > 0
    `
    const paramsDetalhe = []
    
    if (tipo !== 'ambos') {
      sqlDetalhe += ' AND tipo = $1'
      paramsDetalhe.push(tipo)
    }
    
    sqlDetalhe += ' ORDER BY dia_semana, hora_slot, tipo, ident'
    const { rows: voosDetalhe } = await query(sqlDetalhe, paramsDetalhe)

    const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
    const matriz = {}
    for (let d = 0; d <= 6; d++) {
      matriz[d] = { label: dias[d], horas: {} }
      for (let h = 0; h <= 23; h++) {
        matriz[d].horas[h] = { chegada: 0, partida: 0, total: 0, voos: 0 }
      }
    }

    for (const row of rowsMatriz) {
      const slot = matriz[row.dia_semana]?.horas[row.hora_slot]
      if (!slot) continue
      slot[row.tipo] += row.pax_estimado
      slot.total += row.pax_estimado
      slot.voos += 1
    }

    const porCia = {}
    for (const row of rowsMatriz) {
      const op = row.operator_iata || 'N/D'
      porCia[op] = (porCia[op] || 0) + (row.pax_estimado || 0)
    }
    const topCompanhias = Object.entries(porCia)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([iata, pax]) => ({ iata, pax_total: pax }))

    let pico = { dia: null, hora: null, pax: 0 }
    for (let d = 0; d <= 6; d++) {
      for (let h = 0; h <= 23; h++) {
        const val = matriz[d].horas[h].total
        if (val > pico.pax) {
          pico = { dia: dias[d], hora: h, pax: val }
        }
      }
    }

    return reply.send({
      tipo,
      total_registros: rowsMatriz.length,
      pico_semana: pico,
      top_companhias: topCompanhias,
      matriz,
      voos_detalhe: voosDetalhe
    })
  })

  // GET /api/analytics/resumo-vix
  fastify.get('/resumo-vix', async (request, reply) => {
    const { rows } = await query(`
      SELECT dia_semana, tipo, pax_estimado
      FROM flight_history
      WHERE pax_estimado IS NOT NULL
    `)

    const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
    const resumo = dias.map((label, i) => {
      const doDia = rows.filter(r => r.dia_semana === i)
      const chegadas = doDia.filter(r => r.tipo === 'chegada')
      const partidas = doDia.filter(r => r.tipo === 'partida')
      return {
        dia: label,
        dia_semana: i,
        total_voos: doDia.length,
        voos_chegada: chegadas.length,
        voos_partida: partidas.length,
        pax_desembarcando: chegadas.reduce((s, r) => s + (r.pax_estimado || 0), 0),
        pax_embarcando: partidas.reduce((s, r) => s + (r.pax_estimado || 0), 0)
      }
    })

    return reply.send({ resumo })
  })
}
