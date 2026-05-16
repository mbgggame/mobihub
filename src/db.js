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
      lider_id INTEGER,
      balance_due DOUBLE PRECISION DEFAULT 0,
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
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS chave_pix TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS tipo_chave_pix TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS asaas_id TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cep TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS logradouro TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS numero TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS complemento TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bairro TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cidade TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS estado TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS data_nascimento DATE;
    
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
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS forma_pagamento TEXT DEFAULT '1';
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS valor_lider DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS balance_due DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lider_id INTEGER;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS balance_due DOUBLE PRECISION DEFAULT 0;

    -- Campos de Memória de Cálculo (Transparência Billing) 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS base_value DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS wait_extra_minutes DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS wait_extra_charge DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS stop_extra_minutes DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS stop_extra_charge DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS total_value DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS asaas_payment_id TEXT; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS asaas_payment_link TEXT; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS asaas_pix_qrcode TEXT; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS asaas_pix_payload TEXT; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS pagamento_status TEXT DEFAULT 'pendente'; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP; 
    ALTER TABLE tarifas ADD COLUMN IF NOT EXISTS aplicar_feriados BOOLEAN DEFAULT false;
    ALTER TABLE feriados ADD COLUMN IF NOT EXISTS horario_inicio TIME;
    ALTER TABLE feriados ADD COLUMN IF NOT EXISTS horario_fim TIME;
    ALTER TABLE feriados ADD COLUMN IF NOT EXISTS valor_minimo DOUBLE PRECISION;
    ALTER TABLE feriados ADD COLUMN IF NOT EXISTS valor_km DOUBLE PRECISION;
    ALTER TABLE feriados ADD COLUMN IF NOT EXISTS km_minimo DOUBLE PRECISION;

    DO $$ BEGIN 
      IF NOT EXISTS ( 
        SELECT 1 FROM pg_constraint WHERE conname = 'feriados_data_nome_unique' 
      ) THEN 
        ALTER TABLE feriados ADD CONSTRAINT feriados_data_nome_unique UNIQUE (data, nome); 
      END IF; 
    END $$;
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
    ); 

    CREATE TABLE IF NOT EXISTS driver_transactions ( 
      id SERIAL PRIMARY KEY, 
      driver_id INTEGER REFERENCES drivers(id), 
      ride_id INTEGER REFERENCES rides(id), 
      tipo TEXT NOT NULL, 
      descricao TEXT NOT NULL, 
      valor DOUBLE PRECISION NOT NULL, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    );

    CREATE TABLE IF NOT EXISTS feriados (
      id SERIAL PRIMARY KEY,
      data DATE NOT NULL,
      nome TEXT NOT NULL,
      tipo TEXT DEFAULT 'nacional',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Inserir feriados de 2026
  await query(`
    UPDATE feriados SET data = '2026-05-23' WHERE nome LIKE '%Colonização%' AND data = '2026-05-22';
    UPDATE feriados SET data = '2026-09-07' WHERE nome LIKE '%Independência%' AND data = '2026-09-06';
    UPDATE feriados SET data = '2026-06-24' WHERE nome LIKE '%João Batista%' AND data = '2026-06-23';
    UPDATE feriados SET data = '2026-06-29' WHERE nome LIKE '%Pedro%' AND data = '2026-06-28';
    UPDATE feriados SET data = '2026-07-23' WHERE nome LIKE '%Viana%' AND data = '2026-07-22';
  `)

  await query(`
    INSERT INTO feriados (data, nome, tipo) VALUES
      ('2026-01-01', 'Ano Novo', 'nacional'),
      ('2026-03-02', 'Carnaval (Segunda-feira)', 'nacional'),
      ('2026-03-03', 'Carnaval (Terça-feira)', 'nacional'),
      ('2026-03-04', 'Quarta de Cinzas', 'nacional'),
      ('2026-04-03', 'Sexta-Feira Santa', 'nacional'),
      ('2026-04-05', 'Páscoa', 'nacional'),
      ('2026-04-21', 'Tiradentes', 'nacional'),
      ('2026-05-01', 'Dia do Trabalho', 'nacional'),
      ('2026-06-04', 'Corpus Christi', 'nacional'),
      ('2026-09-07', 'Independência do Brasil', 'nacional'),
      ('2026-10-12', 'Nossa Senhora Aparecida', 'nacional'),
      ('2026-11-02', 'Finados', 'nacional'),
      ('2026-11-15', 'Proclamação da República', 'nacional'),
      ('2026-11-20', 'Consciência Negra', 'nacional'),
      ('2026-12-25', 'Natal', 'nacional'),
      ('2026-04-13', 'Nossa Senhora da Penha (Padroeira do ES)', 'estadual'),
      ('2026-05-23', 'Colonização do Solo Espírito-Santense', 'estadual'),
      ('2026-04-03', 'Paixão de Cristo (Vitória)', 'municipal'),
      ('2026-06-04', 'Corpus Christi (Vitória)', 'municipal'),
      ('2026-09-08', 'Nossa Senhora da Vitória / Aniversário de Vitória', 'municipal'),
      ('2026-04-03', 'Paixão de Cristo (Vila Velha)', 'municipal'),
      ('2026-05-23', 'Colonização do Solo ES (Vila Velha)', 'municipal'),
      ('2026-06-29', 'São Pedro (Serra)', 'municipal'),
      ('2026-12-08', 'Nossa Senhora da Conceição (Serra)', 'municipal'),
      ('2026-12-26', 'Dia do Serrano (Serra)', 'municipal'),
      ('2026-04-03', 'Paixão de Cristo (Cariacica)', 'municipal'),
      ('2026-06-04', 'Corpus Christi (Cariacica)', 'municipal'),
      ('2026-06-24', 'São João Batista (Cariacica)', 'municipal'),
      ('2026-07-23', 'Aniversário de Viana', 'municipal'),
      ('2026-12-08', 'Nossa Senhora da Conceição (Viana)', 'municipal')
    ON CONFLICT (data, nome) DO NOTHING
  `) 

  await query(` 
    -- Campo líder no cadastro do motorista 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lider_id TEXT; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS codigo_indicacao TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT; 
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS cpf TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS telegram_id TEXT; 

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
      com_lider BOOLEAN DEFAULT false, 
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
      ('valor_minimo_corrida', '15.00')
    ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor
  `) 
 
  await seedAdmin() 
  await seedConfigs() 
  await seedTarifas()

  // Adicionar coluna com_lider se não existir
  await query(`ALTER TABLE split_rules ADD COLUMN IF NOT EXISTS com_lider BOOLEAN DEFAULT false`)

  // Seed das regras de split padrão
  const splitExisting = await query('SELECT COUNT(*) as total FROM split_rules') 
  if (parseInt(splitExisting.rows[0].total) === 0) { 
    await query(`INSERT INTO split_rules (nome, categoria, percentual_plataforma, percentual_lider, percentual_motorista, com_lider, ativo) 
      VALUES 
        ('Padrão sem Líder', 'padrao', 18, 0, 82, false, 1),
        ('Padrão com Líder', 'padrao', 15, 3, 82, true, 1)`) 
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
