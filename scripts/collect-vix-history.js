/**
 * MobiHub — Coleta histórico de voos VIX (SBVT)
 * Uso: node scripts/collect-vix-history.js
 * Consome ~18 das 500 consultas gratuitas da AeroAPI.
 * Rodar UMA VEZ localmente para popular o banco.
 *
 * Requer no .env:
 *   FLIGHTAWARE_API_KEY=sua_chave
 *   DATABASE_URL=...
 */

import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const AEROAPI_BASE  = 'https://aeroapi.flightaware.com/aeroapi';
const API_KEY       = process.env.FLIGHTAWARE_API_KEY;
const AIRPORT       = 'SBVT';
const DIAS_ATRAS    = 9;
const TAXA_OCUPACAO = 0.82;

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: process.env.DATABASE_URL?.includes('render.com') 
    ? { rejectUnauthorized: false } 
    : false 
});

function nowBrasilia() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}
function toBrasilia(iso) {
  if (!iso) return null;
  return new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function formatDate(d) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }

async function getCapacity(aircraftType) {
  if (!aircraftType) return null;
  const res = await pool.query(
    'SELECT max_pax FROM aircraft_capacity WHERE aircraft_type = $1', 
    [aircraftType]
  );
  return res.rows[0]?.max_pax || null;
}

async function fetchFlights(tipo, startDate, endDate) {
  const ep  = tipo === 'chegada' ? 'arrivals' : 'departures';
  const url = `${AEROAPI_BASE}/airports/${AIRPORT}/flights/${ep}` +
              `?start=${formatDate(startDate)}&end=${formatDate(endDate)}&max_pages=1`;
  const res = await fetch(url, { headers: { 'x-apikey': API_KEY } });
  if (!res.ok) throw new Error(`AeroAPI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.arrivals || data.departures || [];
}

async function processarVoo(voo, tipo) {
  const horarioRaw = tipo === 'chegada'
    ? (voo.actual_in  || voo.estimated_in  || voo.scheduled_in)
    : (voo.actual_out || voo.estimated_out || voo.scheduled_out);
  if (!horarioRaw) return null;

  const bsb      = toBrasilia(horarioRaw);
  const maxPax   = await getCapacity(voo.aircraft_type);

  return {
    flight_id:     voo.fa_flight_id,
    ident:         voo.ident,
    operator:      voo.operator_friendly_name || voo.operator || null,
    operator_iata: voo.operator_iata || null,
    operator_icao: voo.operator_icao || null,
    aircraft_type: voo.aircraft_type || null,
    max_pax:       maxPax,
    pax_estimado:  maxPax ? Math.round(maxPax * TAXA_OCUPACAO) : null,
    tipo,
    origem_iata:   voo.origin?.code_iata || null,
    destino_iata:  voo.destination?.code_iata || null,
    horario:       horarioRaw,
    horario_bsb:   bsb,
    dia_semana:    bsb.getDay(),
    hora_slot:     bsb.getHours(),
    status:        voo.status || null
  };
}

async function coletarDia(data, tipo) {
  const inicio = new Date(data); inicio.setUTCHours(0, 0, 0, 0);
  const fim    = new Date(data); fim.setUTCHours(23, 59, 59, 0);
  const voos   = await fetchFlights(tipo, inicio, fim);
  console.log(`  → ${voos.length} voos`);
  let salvos = 0;
  for (const voo of voos) {
    const reg = await processarVoo(voo, tipo);
    if (!reg) continue;
    try {
      await pool.query(`
        INSERT INTO flight_history (
          flight_id, ident, operator, operator_iata, operator_icao, 
          aircraft_type, max_pax, pax_estimado, tipo, origem_iata, 
          destino_iata, horario, horario_bsb, dia_semana, hora_slot, 
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (flight_id) DO NOTHING
      `, [
        reg.flight_id, reg.ident, reg.operator, reg.operator_iata, 
        reg.operator_icao, reg.aircraft_type, reg.max_pax, 
        reg.pax_estimado, reg.tipo, reg.origem_iata, 
        reg.destino_iata, reg.horario, reg.horario_bsb, 
        reg.dia_semana, reg.hora_slot, reg.status
      ]);
      salvos++;
    } catch (err) {
      console.error(`  ❌ Erro ao salvar voo ${reg.flight_id}:`, err.message);
    }
    await sleep(100);
  }
  return salvos;
}

async function main() {
  console.log('🛫 MobiHub — Coleta histórico VIX');
  console.log(`📅 Últimos ${DIAS_ATRAS} dias...\n`);
  if (!API_KEY) { 
    console.error('❌ FLIGHTAWARE_API_KEY não definida'); 
    await pool.end(); 
    process.exit(1); 
  }
  if (!process.env.DATABASE_URL) { 
    console.error('❌ DATABASE_URL não definida'); 
    await pool.end(); 
    process.exit(1); 
  }

  const hoje = nowBrasilia();
  let totalVoos = 0, totalQuery = 0;

  for (let i = DIAS_ATRAS; i >= 1; i--) {
    const data    = new Date(hoje);
    data.setDate(data.getDate() - i);
    const dataStr = data.toISOString().slice(0, 10);
    const dia     = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][data.getDay()];

    console.log(`📥 [${dia} ${dataStr}] Chegadas...`);
    totalVoos  += await coletarDia(data, 'chegada');
    totalQuery++;
    await sleep(500);

    console.log(`📤 [${dia} ${dataStr}] Partidas...`);
    totalVoos  += await coletarDia(data, 'partida');
    totalQuery++;
    await sleep(500);

    console.log(`   ✅ Queries usadas: ${totalQuery}/500\n`);
  }

  console.log('════════════════════════════════');
  console.log(`✅ Concluído! Voos salvos: ${totalVoos}`);
  console.log(`🔢 Queries usadas: ${totalQuery}/500`);
  console.log(`💰 Custo: R$ 0,00`);
  await pool.end();
}

main().catch(async (err) => { 
  console.error('❌', err); 
  await pool.end(); 
  process.exit(1); 
});
