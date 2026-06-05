import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: process.env.DATABASE_URL?.includes('render.com') 
    ? { rejectUnauthorized: false } 
    : false 
});

const updates = [
  { type: 'A20N', max_pax: 174, pax_estimado: 143 },
  { type: 'A319', max_pax: 144, pax_estimado: 118 },
  { type: 'A320', max_pax: 180, pax_estimado: 148 },
  { type: 'A321', max_pax: 220, pax_estimado: 180 },
  { type: 'B38M', max_pax: 189, pax_estimado: 155 },
  { type: 'B737', max_pax: 149, pax_estimado: 123 },
  { type: 'B738', max_pax: 189, pax_estimado: 155 },
  { type: 'E295', max_pax: 136, pax_estimado: 112 }
];

async function main() {
  console.log('🔧 Iniciando correção de pax_estimado...\n');
  for (const update of updates) {
    const result = await pool.query(
      'UPDATE flight_history SET pax_estimado = $1, max_pax = $2 WHERE aircraft_type = $3 AND pax_estimado IS NULL',
      [update.pax_estimado, update.max_pax, update.type]
    );
    console.log(`✈️ ${update.type}: ${result.rowCount} linhas atualizadas`);
  }
  await pool.end();
  console.log('\n✅ Concluído!');
}

main().catch(async err => {
  console.error('❌ Erro:', err);
  await pool.end();
  process.exit(1);
});
