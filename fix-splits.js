import { query, initDB } from './src/db.js'

async function run() {
  await initDB()
  console.log('[DB] Conectado')
  
  await query('DELETE FROM split_rules')
  console.log('[DB] Deletadas regras antigas')
  
  await query(`INSERT INTO split_rules (nome, percentual_plataforma, percentual_lider, percentual_motorista, com_lider, ativo) VALUES ('Padrão sem Líder', 18, 0, 82, false, 1)`)
  console.log('[DB] Inserida regra sem líder')
  
  await query(`INSERT INTO split_rules (nome, percentual_plataforma, percentual_lider, percentual_motorista, com_lider, ativo) VALUES ('Padrão com Líder', 15, 3, 82, true, 1)`)
  console.log('[DB] Inserida regra com líder')
  
  const splits = (await query('SELECT * FROM split_rules')).rows
  console.log('[DB] Regras atualizadas:', splits)
  
  process.exit(0)
}

run().catch(console.error)
