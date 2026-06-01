CREATE TABLE IF NOT EXISTS indicacao_config (
  id SERIAL PRIMARY KEY,
  ativo BOOLEAN DEFAULT false,
  bonus_motorista DOUBLE PRECISION DEFAULT 5.00,
  desconto_passageiro DOUBLE PRECISION DEFAULT 10.00,
  min_corridas_liberar INT DEFAULT 1,
  validade_dias INT DEFAULT 30,
  limite_mes INT DEFAULT 50,
  tipo_bonus TEXT DEFAULT 'credito',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO indicacao_config (ativo) VALUES (false);

CREATE TABLE IF NOT EXISTS indicacoes (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER REFERENCES drivers(id),
  client_id INTEGER REFERENCES clients(id),
  codigo TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pendente',
  bonus_liberado BOOLEAN DEFAULT false,
  bonus_valor DOUBLE PRECISION DEFAULT 0,
  desconto_aplicado BOOLEAN DEFAULT false,
  desconto_valor DOUBLE PRECISION DEFAULT 0,
  corridas_completadas INT DEFAULT 0,
  expira_em TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS codigo_indicacao_proprio TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS codigo_indicacao_usado TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS desconto_primeira_corrida DOUBLE PRECISION DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS desconto_usado BOOLEAN DEFAULT false;
