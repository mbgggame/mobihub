import Database from 'better-sqlite3' 
import { join, dirname } from 'path' 
import { fileURLToPath } from 'url' 
import bcrypt from 'bcrypt' 
 
const __dirname = dirname(fileURLToPath(import.meta.url)) 
const DB_PATH = join(__dirname, '..', 'mobihub.db') 
 
export const db = new Database(DB_PATH) 
 
db.pragma('journal_mode = WAL') 
db.pragma('foreign_keys = ON') 
 
export function initDB() { 
  db.exec(` 
 
    CREATE TABLE IF NOT EXISTS admins ( 
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      email TEXT UNIQUE NOT NULL, 
      senha_hash TEXT NOT NULL, 
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP 
    ); 
 
    CREATE TABLE IF NOT EXISTS drivers ( 
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      nome TEXT NOT NULL, 
      telefone TEXT, 
      telegram_id TEXT UNIQUE NOT NULL, 
      modelo_carro TEXT NOT NULL, 
      ano_carro TEXT NOT NULL, 
      cor_carro TEXT NOT NULL, 
      placa TEXT NOT NULL, 
      total_viagens INTEGER DEFAULT 0, 
      media_avaliacao REAL DEFAULT 0, 
      total_avaliacoes INTEGER DEFAULT 0, 
      ativo INTEGER DEFAULT 1, 
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP 
    ); 
 
    CREATE TABLE IF NOT EXISTS clients ( 
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      telefone TEXT UNIQUE NOT NULL, 
      nome TEXT, 
      total_corridas INTEGER DEFAULT 0, 
      media_avaliacao REAL DEFAULT 0, 
      total_avaliacoes INTEGER DEFAULT 0, 
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP 
    ); 
 
    CREATE TABLE IF NOT EXISTS rides ( 
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      token TEXT UNIQUE NOT NULL, 
      client_id INTEGER REFERENCES clients(id), 
      driver_id INTEGER REFERENCES drivers(id), 
      origem TEXT NOT NULL, 
      origem_lat REAL, 
      origem_lng REAL, 
      destino TEXT NOT NULL, 
      destino_lat REAL, 
      destino_lng REAL, 
      valor REAL NOT NULL, 
      status TEXT DEFAULT 'aberta', 
      maps_link TEXT, 
      telegram_message_id INTEGER, 
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
      aceita_at DATETIME, 
      concluida_at DATETIME, 
      cancelada_at DATETIME 
    ); 
 
    CREATE TABLE IF NOT EXISTS ratings ( 
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      ride_id INTEGER UNIQUE REFERENCES rides(id), 
      estrelas_motorista INTEGER CHECK(estrelas_motorista BETWEEN 1 AND 5), 
      comentario_cliente TEXT, 
      avaliado_em_cliente DATETIME, 
      estrelas_cliente INTEGER CHECK(estrelas_cliente BETWEEN 1 AND 5), 
      comentario_motorista TEXT, 
      avaliado_em_motorista DATETIME, 
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP 
    ); 
 
  `) 
 
  seedAdmin() 
 
  try { 
    db.prepare("ALTER TABLE drivers ADD COLUMN foto_base64 TEXT").run() 
  } catch(e) {} 
 
  try { db.prepare("ALTER TABLE rides ADD COLUMN valor_motorista REAL").run() } catch(e) {} 
  try { db.prepare("ALTER TABLE rides ADD COLUMN valor_mobihub REAL").run() } catch(e) {} 
 
  try { db.prepare("ALTER TABLE rides ADD COLUMN tipo TEXT DEFAULT 'normal'").run() } catch(e) {} 
  try { db.prepare("ALTER TABLE rides ADD COLUMN agendada_para DATETIME").run() } catch(e) {} 
  try { db.prepare("ALTER TABLE rides ADD COLUMN disparada_at DATETIME").run() } catch(e) {} 
 
  db.exec(` 
    CREATE TABLE IF NOT EXISTS tarifas ( 
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      nome TEXT NOT NULL, 
      dias TEXT NOT NULL, 
      hora_inicio TEXT NOT NULL, 
      hora_fim TEXT NOT NULL, 
      valor_minimo REAL NOT NULL, 
      valor_km REAL DEFAULT 2.00, 
      km_minimo REAL DEFAULT 7.5, 
      ativo INTEGER DEFAULT 1 
    ); 
 
    CREATE TABLE IF NOT EXISTS configuracoes ( 
      chave TEXT PRIMARY KEY, 
      valor TEXT NOT NULL 
    ); 
  `) 
 
  const configsIniciais = { 
    'agendamento_disparo_imediato': 'true', 
    'agendamento_minutos_antes': '30', 
    'agendamento_bloqueio_ativo': 'true', 
    'agendamento_minutos_bloqueio': '60', 
    'corrida_valor_minimo': '15', 
    'corrida_km_minimo': '7.5', 
    'corrida_valor_km': '2' 
  } 
 
  const insertConfig = db.prepare(` 
    INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?) 
  `) 
  for (const [chave, valor] of Object.entries(configsIniciais)) { 
    insertConfig.run(chave, valor) 
  } 
 
  const tarifasExistentes = db.prepare('SELECT COUNT(*) as total FROM tarifas').get() 
  if (tarifasExistentes.total === 0) { 
    const insert = db.prepare(` 
      INSERT INTO tarifas (nome, dias, hora_inicio, hora_fim, valor_minimo, valor_km, km_minimo) 
      VALUES (?, ?, ?, ?, ?, ?, ?) 
    `) 
    insert.run('Padrão', '1,2,3,4,5', '09:00', '17:00', 15.00, 2.00, 7.5) 
    insert.run('Pico manhã', '1,2,3,4,5', '06:00', '09:00', 20.00, 2.00, 7.5) 
    insert.run('Pico tarde', '1,2,3,4,5', '17:00', '20:00', 20.00, 2.00, 7.5) 
    insert.run('Noturno', '0,1,2,3,4,5,6', '20:00', '06:00', 22.00, 2.00, 7.5) 
    insert.run('Fim de semana', '0,6', '06:00', '20:00', 22.00, 2.00, 7.5) 
    insert.run('Fim de semana noturno', '0,6', '20:00', '06:00', 25.00, 2.00, 7.5) 
  } 
} 
 
function seedAdmin() { 
  const existing = db.prepare('SELECT id FROM admins LIMIT 1').get() 
  if (existing) return 
  const email = process.env.ADMIN_EMAIL || 'admin@mobihub.com' 
  const senha = process.env.ADMIN_SENHA || 'mobihub123' 
  const hash = bcrypt.hashSync(senha, 10) 
  db.prepare('INSERT INTO admins (email, senha_hash) VALUES (?, ?)').run(email, hash) 
  console.log(`[DB] Admin criado: ${email}`) 
}
