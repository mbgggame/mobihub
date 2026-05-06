import pg from 'pg' 
 import bcrypt from 'bcrypt' 
 
 const { Pool } = pg 
 
 export const pool = new Pool({ 
   connectionString: process.env.DATABASE_URL, 
   ssl: process.env.DATABASE_URL?.includes('render.com') 
     ? { rejectUnauthorized: false } 
     : false 
 }) 
 
 // Compatibilidade com código existente que usa db.prepare() 
 export const db = { 
   prepare: (sql) => ({ 
     run: (...params) => { 
       const query = convertSQL(sql) 
       return runSync(query, params) 
     }, 
     get: (...params) => { 
       const query = convertSQL(sql) 
       return getSync(query, params) 
     }, 
     all: (...params) => { 
       const query = convertSQL(sql) 
       return allSync(query, params) 
     } 
   }), 
   exec: (sql) => { 
     const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0) 
     for (const stmt of statements) { 
       runSync(stmt, []) 
     } 
   }, 
   pragma: () => {}, 
   transaction: (fn) => (...args) => fn(...args) 
 } 
 
 // Converte SQL do SQLite para PostgreSQL 
 function convertSQL(sql) { 
   return sql 
     .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY') 
     .replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/gi, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP') 
     .replace(/DATETIME/gi, 'TIMESTAMP') 
     .replace(/TEXT/gi, 'TEXT') 
     .replace(/REAL/gi, 'DOUBLE PRECISION') 
     .replace(/\?/g, () => `$${++convertSQL._counter}`) 
 } 
 convertSQL._counter = 0 
 
 function resetCounter(sql) { 
   convertSQL._counter = 0 
   return sql 
 } 
 
 function convertSQLWithCounter(sql) { 
   convertSQL._counter = 0 
   return convertSQL(sql) 
 } 
 
 // Executa query síncrona usando Atomics 
 function runSync(sql, params) { 
   const converted = convertSQLWithCounter(sql) 
   const result = runAsync(converted, params) 
   return { lastInsertRowid: result?.id, changes: result?.rowCount } 
 } 
 
 function getSync(sql, params) { 
   const converted = convertSQLWithCounter(sql) 
   return getAsync(converted, params) 
 } 
 
 function allSync(sql, params) { 
   const converted = convertSQLWithCounter(sql) 
   return allAsync(converted, params) 
 } 
 
 // Armazena resultados pendentes 
 const pending = new Map() 
 let reqId = 0 
 
 function runAsync(sql, params) { 
   const id = ++reqId 
   pool.query(sql, params) 
     .then(r => pending.set(id, { done: true, result: r.rows[0] })) 
     .catch(e => { console.error('[DB ERROR]', e.message, sql); pending.set(id, { done: true, result: null }) }) 
 
   const start = Date.now() 
   while (!pending.has(id) || !pending.get(id).done) { 
     if (Date.now() - start > 5000) break 
     Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10) 
   } 
   const r = pending.get(id) 
   pending.delete(id) 
   return r?.result 
 } 
 
 function getAsync(sql, params) { 
   const id = ++reqId 
   pool.query(sql, params) 
     .then(r => pending.set(id, { done: true, result: r.rows[0] || null })) 
     .catch(e => { console.error('[DB ERROR]', e.message, sql); pending.set(id, { done: true, result: null }) }) 
 
   const start = Date.now() 
   while (!pending.has(id) || !pending.get(id).done) { 
     if (Date.now() - start > 5000) break 
     Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10) 
   } 
   const r = pending.get(id) 
   pending.delete(id) 
   return r?.result 
 } 
 
 function allAsync(sql, params) { 
   const id = ++reqId 
   pool.query(sql, params) 
     .then(r => pending.set(id, { done: true, result: r.rows || [] })) 
     .catch(e => { console.error('[DB ERROR]', e.message, sql); pending.set(id, { done: true, result: [] }) }) 
 
   const start = Date.now() 
   while (!pending.has(id) || !pending.get(id).done) { 
     if (Date.now() - start > 5000) break 
     Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10) 
   } 
   const r = pending.get(id) 
   pending.delete(id) 
   return r?.result 
 } 
 
 export async function initDB() { 
   await pool.query(` 
     CREATE TABLE IF NOT EXISTS admins ( 
       id SERIAL PRIMARY KEY, 
       email TEXT UNIQUE NOT NULL, 
       senha_hash TEXT NOT NULL, 
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
     ); 
 
     CREATE TABLE IF NOT EXISTS drivers ( 
       id SERIAL PRIMARY KEY, 
       nome TEXT NOT NULL, 
       telefone TEXT, 
       telegram_id TEXT UNIQUE NOT NULL, 
       modelo_carro TEXT NOT NULL, 
       ano_carro TEXT NOT NULL, 
       cor_carro TEXT NOT NULL, 
       placa TEXT NOT NULL, 
       total_viagens INTEGER DEFAULT 0, 
       media_avaliacao DOUBLE PRECISION DEFAULT 0, 
       total_avaliacoes INTEGER DEFAULT 0, 
       ativo INTEGER DEFAULT 1, 
       foto_base64 TEXT, 
       token_perfil TEXT, 
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
     ); 
 
     CREATE TABLE IF NOT EXISTS clients ( 
       id SERIAL PRIMARY KEY, 
       telefone TEXT UNIQUE NOT NULL, 
       nome TEXT, 
       email TEXT, 
       total_corridas INTEGER DEFAULT 0, 
       media_avaliacao DOUBLE PRECISION DEFAULT 0, 
       total_avaliacoes INTEGER DEFAULT 0, 
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
     ); 
 
     CREATE TABLE IF NOT EXISTS rides ( 
       id SERIAL PRIMARY KEY, 
       token TEXT UNIQUE NOT NULL, 
       client_id INTEGER REFERENCES clients(id), 
       driver_id INTEGER REFERENCES drivers(id), 
       origem TEXT NOT NULL, 
       origem_lat DOUBLE PRECISION, 
       origem_lng DOUBLE PRECISION, 
       destino TEXT NOT NULL, 
       destino_lat DOUBLE PRECISION, 
       destino_lng DOUBLE PRECISION, 
       valor DOUBLE PRECISION NOT NULL, 
       valor_motorista DOUBLE PRECISION, 
       valor_mobihub DOUBLE PRECISION, 
       status TEXT DEFAULT 'aberta', 
       tipo TEXT DEFAULT 'normal', 
       maps_link TEXT, 
       telegram_message_id INTEGER, 
       agendada_para TIMESTAMP, 
       disparada_at TIMESTAMP, 
       concluida_auto INTEGER DEFAULT 0, 
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
       aceita_at TIMESTAMP, 
       concluida_at TIMESTAMP, 
       cancelada_at TIMESTAMP 
     ); 
 
     CREATE TABLE IF NOT EXISTS ratings ( 
       id SERIAL PRIMARY KEY, 
       ride_id INTEGER UNIQUE REFERENCES rides(id), 
       estrelas_motorista INTEGER CHECK(estrelas_motorista BETWEEN 1 AND 5), 
       comentario_cliente TEXT, 
       avaliado_em_cliente TIMESTAMP, 
       estrelas_cliente INTEGER CHECK(estrelas_cliente BETWEEN 1 AND 5), 
       comentario_motorista TEXT, 
       avaliado_em_motorista TIMESTAMP, 
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
     ); 
 
     CREATE TABLE IF NOT EXISTS driver_locations ( 
       id SERIAL PRIMARY KEY, 
       driver_id INTEGER REFERENCES drivers(id), 
       ride_id INTEGER REFERENCES rides(id), 
       lat DOUBLE PRECISION NOT NULL, 
       lng DOUBLE PRECISION NOT NULL, 
       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
     ); 
 
     CREATE TABLE IF NOT EXISTS configuracoes ( 
       chave TEXT PRIMARY KEY, 
       valor TEXT NOT NULL 
     ); 
 
     CREATE TABLE IF NOT EXISTS tarifas ( 
       id SERIAL PRIMARY KEY, 
       nome TEXT NOT NULL, 
       dias TEXT NOT NULL, 
       hora_inicio TEXT NOT NULL, 
       hora_fim TEXT NOT NULL, 
       valor_minimo DOUBLE PRECISION NOT NULL, 
       valor_km DOUBLE PRECISION DEFAULT 2.00, 
       km_minimo DOUBLE PRECISION DEFAULT 7.5, 
       ativo INTEGER DEFAULT 1 
     ); 
   `) 
 
   await seedAdmin() 
   await seedConfigs() 
   await seedTarifas() 
   console.log('[DB] PostgreSQL inicializado') 
 } 
 
 async function seedAdmin() { 
   const existing = await pool.query('SELECT id FROM admins LIMIT 1') 
   if (existing.rows.length > 0) return 
   const email = process.env.ADMIN_EMAIL || 'admin@mobihub.com' 
   const senha = process.env.ADMIN_SENHA || 'mobihub123' 
   const hash = await bcrypt.hash(senha, 10) 
   await pool.query('INSERT INTO admins (email, senha_hash) VALUES ($1, $2)', [email, hash]) 
   console.log(`[DB] Admin criado: ${email}`) 
 } 
 
 async function seedConfigs() { 
   const configs = { 
     'agendamento_disparo_imediato': 'true', 
     'agendamento_minutos_antes': '30', 
     'agendamento_bloqueio_ativo': 'true', 
     'agendamento_minutos_bloqueio': '60', 
     'corrida_valor_minimo': '15', 
     'corrida_km_minimo': '7.5', 
     'corrida_valor_km': '2', 
     'chegada_raio_metros': '150', 
     'chegada_auto_ativo': 'true' 
   } 
   for (const [chave, valor] of Object.entries(configs)) { 
     await pool.query( 
       'INSERT INTO configuracoes (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING', 
       [chave, valor] 
     ) 
   } 
 } 
 
 async function seedTarifas() { 
   const existing = await pool.query('SELECT COUNT(*) as total FROM tarifas') 
   if (parseInt(existing.rows[0].total) > 0) return 
   
   const tarifas = [ 
     ['Padrão', '1,2,3,4,5', '09:00', '17:00', 15.00], 
     ['Pico manhã', '1,2,3,4,5', '06:00', '09:00', 20.00], 
     ['Pico tarde', '1,2,3,4,5', '17:00', '20:00', 20.00], 
     ['Noturno', '0,1,2,3,4,5,6', '20:00', '06:00', 22.00], 
     ['Fim de semana', '0,6', '06:00', '20:00', 22.00], 
     ['Fim de semana noturno', '0,6', '20:00', '06:00', 25.00] 
   ] 
   
   for (const t of tarifas) { 
     await pool.query( 
       'INSERT INTO tarifas (nome, dias, hora_inicio, hora_fim, valor_minimo) VALUES ($1, $2, $3, $4, $5)', 
       [t[0], t[1], t[2], t[3], t[4]] 
     ) 
   } 
 } 
