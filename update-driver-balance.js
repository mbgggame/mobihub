
import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com')
    ? { rejectUnauthorized: false }
    : false
})

async function run() {
  try {
    console.log('Atualizando balance_due do motorista id=2...')
    await pool.query('UPDATE drivers SET balance_due = 3.75 WHERE id = 2')
    console.log('✅ Atualizado com sucesso!')

    console.log('\nListando motoristas...')
    const result = await pool.query('SELECT id, nome, balance_due FROM drivers')
    console.table(result.rows)
  } catch (err) {
    console.error('❌ Erro:', err)
  } finally {
    await pool.end()
  }
}

run()
