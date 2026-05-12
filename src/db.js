import pg from 'pg' 
import bcrypt from 'bcrypt' 
 
const { Pool } = pg 
 
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: process.env.DATABASE_URL?.includes('render.com') 
    ? { rejectUnauthorized: false } 
    : false 
}) 
 
export const query = (text, params) => pool.query(text, params) 
 
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
      telegram_message_id TEXT, 
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
 
  await query(` 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS status_cadastro TEXT DEFAULT 'aprovado'; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS token_convite TEXT; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS convite_expira_em TIMESTAMP; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS motivo_reprovacao TEXT; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS online INTEGER DEFAULT 0; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS online_desde TIMESTAMP; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS aceitou_termos BOOLEAN DEFAULT false;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS data_aceite_termos TIMESTAMP;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS ip_aceite_termos TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS versao_termos TEXT DEFAULT '1.0';
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cpf TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS renavam TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS crlv_base64 TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cnh_frente_base64 TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cnh_verso_base64 TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cnh_digital_base64 TEXT;
    
    -- Remove unique constraint on telegram_id (allow same ID for client -> driver)
    ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_telegram_id_key;
  `) 
 
  await query(` 
    CREATE TABLE IF NOT EXISTS convites ( 
      id SERIAL PRIMARY KEY, 
      token TEXT UNIQUE NOT NULL, 
      expira_em TIMESTAMP NOT NULL, 
      usado BOOLEAN DEFAULT false, 
      usado_em TIMESTAMP, 
      driver_id INTEGER REFERENCES drivers(id), 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ) 
  `) 
 
  await query(` 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS status_detalhe TEXT DEFAULT 'normal'; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS motorista_chegou_at TIMESTAMP; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS passageiro_embarcou_at TIMESTAMP; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS tempo_espera_inicial_min DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS custo_espera_inicial DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS tempo_paradas_total_min DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS custo_paradas DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS num_paradas INTEGER DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS valor_final DOUBLE PRECISION; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancelado_por_espera INTEGER DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS taxa_cancelamento DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancelado_por TEXT;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS forma_pagamento TEXT DEFAULT 'dinheiro';

    -- Campos de Memória de Cálculo (Transparência Billing) 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS base_value DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS wait_extra_minutes DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS wait_extra_charge DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS stop_extra_minutes DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS stop_extra_charge DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS total_value DOUBLE PRECISION DEFAULT 0; 
  `) 
 
  await query(` 
    CREATE TABLE IF NOT EXISTS ride_stops ( 
      id SERIAL PRIMARY KEY, 
      ride_id INTEGER REFERENCES rides(id), 
      iniciada_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
      finalizada_at TIMESTAMP, 
      duracao_min DOUBLE PRECISION, 
      custo DOUBLE PRECISION DEFAULT 0, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ) 
  `) 
 
  await query(` 
    CREATE TABLE IF NOT EXISTS vehicles ( 
      id SERIAL PRIMARY KEY, 
      driver_id INTEGER REFERENCES drivers(id) ON DELETE CASCADE, 
      modelo TEXT NOT NULL, 
      ano TEXT NOT NULL, 
      cor TEXT NOT NULL, 
      placa TEXT NOT NULL, 
      ativo INTEGER DEFAULT 0, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ) 
  `) 
 
  await query(` 
    CREATE TABLE IF NOT EXISTS ride_messages ( 
      id SERIAL PRIMARY KEY, 
      ride_id INTEGER REFERENCES rides(id), 
      remetente TEXT NOT NULL CHECK(remetente IN ('motorista', 'passageiro')), 
      mensagem TEXT NOT NULL, 
      lida INTEGER DEFAULT 0, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ) 
  `) 

  await query(` 
    -- Campo líder no cadastro do motorista 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lider_id TEXT; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS codigo_indicacao TEXT; 

    -- Tabela de configurações de webhook 
    CREATE TABLE IF NOT EXISTS webhooks ( 
      id SERIAL PRIMARY KEY, 
      nome TEXT NOT NULL, 
      url TEXT NOT NULL, 
      evento TEXT NOT NULL, 
      ativo INTEGER DEFAULT 1, 
      secret_key TEXT, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ); 

    -- Tabela de regras de split financeiro 
    CREATE TABLE IF NOT EXISTS split_rules ( 
      id SERIAL PRIMARY KEY, 
      nome TEXT NOT NULL, 
      categoria TEXT DEFAULT 'padrao', 
      percentual_plataforma DOUBLE PRECISION DEFAULT 15, 
      percentual_lider DOUBLE PRECISION DEFAULT 2, 
      percentual_motorista DOUBLE PRECISION DEFAULT 83, 
      ativo INTEGER DEFAULT 1, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ); 

    -- Tabela de log de webhooks disparados 
    CREATE TABLE IF NOT EXISTS webhook_logs ( 
      id SERIAL PRIMARY KEY, 
      webhook_id INTEGER, 
      evento TEXT, 
      payload TEXT, 
      resposta TEXT, 
      status_code INTEGER, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ); 
  `) 
 
  // Migra veículos existentes dos motoristas para a nova tabela 
  await query(` 
    INSERT INTO vehicles (driver_id, modelo, ano, cor, placa, ativo) 
    SELECT id, modelo_carro, ano_carro, cor_carro, placa, 1 
    FROM drivers 
    WHERE modelo_carro IS NOT NULL 
    AND id NOT IN (SELECT DISTINCT driver_id FROM vehicles) 
  `) 
 
  await query(` 
    INSERT INTO configuracoes (chave, valor) VALUES 
      ('espera_minutos_gratis', '3'), 
      ('espera_valor_minuto', '0.60'), 
      ('espera_max_cancelamento', '10'), 
      ('espera_taxa_cancelamento', '10.00'), 
      ('parada_minutos_gratis', '5'), 
      ('parada_valor_minuto', '0.60'), 
      ('valor_minimo_corrida', '15.00'),
      ('comissao_plataforma', '25')
    ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor
  `) 
 
  await seedAdmin() 
  await seedConfigs() 
  await seedTarifas() 

  // Seed da regra de split padrão
  const splitExisting = await query('SELECT COUNT(*) as total FROM split_rules') 
  if (parseInt(splitExisting.rows[0].total) === 0) { 
    await query(`INSERT INTO split_rules (nome, categoria, percentual_plataforma, percentual_lider, percentual_motorista) 
      VALUES ('Padrão', 'padrao', 15, 2, 83)`) 
  }

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
    'chegada_auto_ativo': 'true',
    'parada_auto_metros': '50',
    'parada_auto_segundos': '60'
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
  if (parseInt(existing.rows[0].total) > 0) { 
    return; 
  }
  
  const tarifas = [ 
    ['Padrão', '1,2,3,4,5', '09:00', '17:00', 15.00, 2.50, 1.0], 
    ['Pico manhã', '1,2,3,4,5', '06:00', '09:00', 20.00, 3.00, 1.0], 
    ['Pico tarde', '1,2,3,4,5', '17:00', '20:00', 20.00, 3.00, 1.0], 
    ['Noturno', '0,1,2,3,4,5,6', '20:00', '06:00', 22.00, 3.50, 1.0], 
    ['Fim de semana', '0,6', '06:00', '20:00', 22.00, 3.50, 1.0], 
    ['Fim de semana noturno', '0,6', '20:00', '06:00', 25.00, 4.00, 1.0] 
  ] 
  
  for (const t of tarifas) { 
    await pool.query( 
      'INSERT INTO tarifas (nome, dias, hora_inicio, hora_fim, valor_minimo, valor_km, km_minimo) VALUES ($1, $2, $3, $4, $5, $6, $7)', 
      [t[0], t[1], t[2], t[3], t[4], t[5], t[6]] 
    ) 
  } 
} 
