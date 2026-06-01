CREATE TABLE IF NOT EXISTS cancelamento_motivos (
  id SERIAL PRIMARY KEY,
  codigo TEXT UNIQUE NOT NULL,
  descricao TEXT NOT NULL,
  permite_taxa BOOLEAN DEFAULT false,
  requer_tempo_espera BOOLEAN DEFAULT false,
  monitorar_fraude BOOLEAN DEFAULT false,
  ativo BOOLEAN DEFAULT true,
  ordem INT DEFAULT 0
);

INSERT INTO cancelamento_motivos (codigo, descricao, permite_taxa, requer_tempo_espera, monitorar_fraude, ordem) VALUES
  ('passageiro_nao_apareceu', 'Passageiro não apareceu', true, true, false, 1),
  ('muitas_bagagens', 'Muitas bagagens / Itens volumosos', false, false, false, 2),
  ('comportamento_suspeito', 'Comportamento suspeito / Passageiro agressivo', false, false, true, 3),
  ('crianca_sem_cadeirinha', 'Criança sem cadeirinha', false, false, true, 4),
  ('sem_mascara_cinto', 'Passageiro sem cinto / sem máscara', false, false, true, 5),
  ('motivo_pessoal', 'Não consigo fazer a viagem', false, false, false, 6);

CREATE TABLE IF NOT EXISTS cancelamento_config (
  id SERIAL PRIMARY KEY,
  tempo_espera_minutos INT DEFAULT 5,
  taxa_cancelamento_valor DOUBLE PRECISION DEFAULT 5.00,
  tc_limite_percentual DOUBLE PRECISION DEFAULT 15.00,
  tc_janela_corridas INT DEFAULT 50,
  suspensao_automatica BOOLEAN DEFAULT false,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO cancelamento_config DEFAULT VALUES;

ALTER TABLE rides ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS taxa_cancel_cobrada BOOLEAN DEFAULT false;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS total_cancelamentos INT DEFAULT 0;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS tc_percentual DOUBLE PRECISION DEFAULT 0;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS tc_ultima_atualizacao TIMESTAMP;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS suspenso_tc BOOLEAN DEFAULT false;
