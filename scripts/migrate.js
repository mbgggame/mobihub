import 'dotenv/config';
import pkg from 'pg'; 
const { Client } = pkg; 
import fs from 'fs'; 
import path from 'path'; 
import { fileURLToPath } from 'url'; 

const __dirname = path.dirname(fileURLToPath(import.meta.url)); 
const migrationsDir = path.join(__dirname, '..', 'migrations'); 

const isProd = process.argv.includes('--prod'); 

const connStr = isProd 
  ? process.env.DATABASE_URL_PROD 
  : process.env.DATABASE_URL_DEV; 

if (!connStr) { 
  console.error(`❌ Variável ${isProd ? 'DATABASE_URL_PROD' : 'DATABASE_URL_DEV'} não definida!`); 
  process.exit(1); 
} 

const db = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } }); 

async function run() { 
  await db.connect(); 
  console.log(`🔗 Conectado ao banco ${isProd ? 'PRODUÇÃO' : 'DEV'}`); 

  // Cria tabela de controle se não existir 
  await db.query(` 
    CREATE TABLE IF NOT EXISTS schema_migrations ( 
      id SERIAL PRIMARY KEY, 
      filename TEXT UNIQUE NOT NULL, 
      aplicada_em TIMESTAMP DEFAULT NOW() 
    ) 
  `); 

  // Lista migrations já aplicadas 
  const aplicadas = (await db.query('SELECT filename FROM schema_migrations')).rows.map(r => r.filename); 

  // Lista arquivos de migration ordenados 
  const arquivos = fs.readdirSync(migrationsDir) 
    .filter(f => f.endsWith('.sql')) 
    .sort(); 

  let aplicou = 0; 
  for (const arquivo of arquivos) { 
    if (aplicadas.includes(arquivo)) { 
      console.log(`⏭️  ${arquivo} — já aplicada`); 
      continue; 
    } 
    console.log(`⏳ Aplicando ${arquivo}...`); 
    const sql = fs.readFileSync(path.join(migrationsDir, arquivo), 'utf8'); 
    try { 
      await db.query(sql); 
      await db.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [arquivo]); 
      console.log(`✅ ${arquivo} — aplicada com sucesso!`); 
      aplicou++; 
    } catch(e) { 
      console.error(`❌ Erro em ${arquivo}:`, e.message); 
      process.exit(1); 
    } 
  } 

  if (aplicou === 0) console.log('✨ Banco já está atualizado!'); 
  else console.log(`\n🎉 ${aplicou} migration(s) aplicada(s)!`); 
  await db.end(); 
} 

run().catch(e => { console.error(e); process.exit(1); });
