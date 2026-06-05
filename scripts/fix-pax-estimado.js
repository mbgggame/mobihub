import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com')
    ? { rejectUnauthorized: false }
    : false
});

async function main() {
  const check = await pool.query('SELECT COUNT(*) as total FROM flight_history WHERE pax_estimado IS NULL');
  console.log('Registros com pax_estimado NULL:', check.rows[0].total);

  const result = await pool.query(`
    UPDATE flight_history
    SET pax_estimado = CASE TRIM(aircraft_type)
      WHEN 'A20N' THEN 143
      WHEN 'A319' THEN 118
      WHEN 'A320' THEN 148
      WHEN 'A321' THEN 180
      WHEN 'B38M' THEN 155
      WHEN 'B737' THEN 123
      WHEN 'B738' THEN 155
      WHEN 'E295' THEN 112
      ELSE pax_estimado
    END,
    max_pax = CASE TRIM(aircraft_type)
      WHEN 'A20N' THEN 174
      WHEN 'A319' THEN 144
      WHEN 'A320' THEN 180
      WHEN 'A321' THEN 220
      WHEN 'B38M' THEN 189
      WHEN 'B737' THEN 149
      WHEN 'B738' THEN 189
      WHEN 'E295' THEN 136
      ELSE max_pax
    END
    WHERE pax_estimado IS NULL
  `);

  console.log('Linhas atualizadas:', result.rowCount);

  const confirm = await pool.query('SELECT COUNT(*) as com_pax FROM flight_history WHERE pax_estimado IS NOT NULL');
  console.log('Total com pax_estimado:', confirm.rows[0].com_pax);

  await pool.end();
}

main().catch(console.error);
