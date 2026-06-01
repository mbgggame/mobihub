-- Schema completo do banco MobiHub para Supabase
-- Sequências primeiro
CREATE SEQUENCE IF NOT EXISTS admins_id_seq;
CREATE SEQUENCE IF NOT EXISTS clients_id_seq;
CREATE SEQUENCE IF NOT EXISTS convites_id_seq;
CREATE SEQUENCE IF NOT EXISTS driver_locations_id_seq;
CREATE SEQUENCE IF NOT EXISTS driver_transactions_id_seq;
CREATE SEQUENCE IF NOT EXISTS drivers_id_seq;
CREATE SEQUENCE IF NOT EXISTS feriados_id_seq;
CREATE SEQUENCE IF NOT EXISTS gateway_config_id_seq;
CREATE SEQUENCE IF NOT EXISTS ratings_id_seq;
CREATE SEQUENCE IF NOT EXISTS ride_messages_id_seq;
CREATE SEQUENCE IF NOT EXISTS ride_stops_id_seq;
CREATE SEQUENCE IF NOT EXISTS ride_track_id_seq;
CREATE SEQUENCE IF NOT EXISTS rides_id_seq;
CREATE SEQUENCE IF NOT EXISTS split_rules_id_seq;
CREATE SEQUENCE IF NOT EXISTS tarifas_id_seq;
CREATE SEQUENCE IF NOT EXISTS termos_versoes_id_seq;
CREATE SEQUENCE IF NOT EXISTS vehicles_id_seq;
CREATE SEQUENCE IF NOT EXISTS webhook_logs_id_seq;
CREATE SEQUENCE IF NOT EXISTS webhooks_id_seq;

-- Tabela: admins
CREATE TABLE IF NOT EXISTS "admins" (
  "id" INTEGER NOT NULL DEFAULT nextval('admins_id_seq'::regclass),
  "email" TEXT NOT NULL,
  "senha_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- Tabela: clients
CREATE TABLE IF NOT EXISTS "clients" (
  "id" INTEGER NOT NULL DEFAULT nextval('clients_id_seq'::regclass),
  "telefone" TEXT NOT NULL,
  "nome" TEXT,
  "email" TEXT,
  "total_corridas" INTEGER DEFAULT 0,
  "media_avaliacao" DOUBLE PRECISION DEFAULT 0,
  "total_avaliacoes" INTEGER DEFAULT 0,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "cpf" TEXT,
  "telegram_id" TEXT,
  "balance_due" DOUBLE PRECISION DEFAULT 0,
  "balance_due_charge_id" TEXT,
  "balance_due_charge_link" TEXT,
  "creditos" DOUBLE PRECISION DEFAULT 0,
  "aceitou_termos" BOOLEAN DEFAULT false,
  "data_aceite_termos" TIMESTAMP,
  "ip_aceite_termos" VARCHAR(50),
  "versao_termos" VARCHAR(10),
  "aceite_responsabilidade" BOOLEAN DEFAULT false,
  "hash_aceite_termos" TEXT,
  "ativo" BOOLEAN DEFAULT true,
  PRIMARY KEY ("id")
);

-- Tabela: configuracoes
CREATE TABLE IF NOT EXISTS "configuracoes" (
  "chave" TEXT NOT NULL,
  "valor" TEXT NOT NULL,
  PRIMARY KEY ("chave")
);

-- Tabela: convites
CREATE TABLE IF NOT EXISTS "convites" (
  "id" INTEGER NOT NULL DEFAULT nextval('convites_id_seq'::regclass),
  "token" TEXT NOT NULL,
  "expira_em" TIMESTAMP NOT NULL,
  "usado" BOOLEAN DEFAULT false,
  "usado_em" TIMESTAMP,
  "driver_id" INTEGER,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- Tabela: driver_locations
CREATE TABLE IF NOT EXISTS "driver_locations" (
  "id" INTEGER NOT NULL DEFAULT nextval('driver_locations_id_seq'::regclass),
  "driver_id" INTEGER,
  "ride_id" INTEGER,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- Tabela: driver_transactions
CREATE TABLE IF NOT EXISTS "driver_transactions" (
  "id" INTEGER NOT NULL DEFAULT nextval('driver_transactions_id_seq'::regclass),
  "driver_id" INTEGER,
  "ride_id" INTEGER,
  "tipo" TEXT NOT NULL,
  "descricao" TEXT NOT NULL,
  "valor" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- Tabela: drivers
CREATE TABLE IF NOT EXISTS "drivers" (
  "id" INTEGER NOT NULL DEFAULT nextval('drivers_id_seq'::regclass),
  "nome" TEXT NOT NULL,
  "telefone" TEXT,
  "telegram_id" TEXT,
  "modelo_carro" TEXT NOT NULL,
  "ano_carro" TEXT NOT NULL,
  "cor_carro" TEXT NOT NULL,
  "placa" TEXT NOT NULL,
  "total_viagens" INTEGER DEFAULT 0,
  "media_avaliacao" DOUBLE PRECISION DEFAULT 0,
  "total_avaliacoes" INTEGER DEFAULT 0,
  "ativo" INTEGER DEFAULT 1,
  "foto_base64" TEXT,
  "token_perfil" TEXT,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "status_cadastro" TEXT DEFAULT 'aprovado'::text,
  "token_convite" TEXT,
  "convite_expira_em" TIMESTAMP,
  "motivo_reprovacao" TEXT,
  "online" INTEGER DEFAULT 0,
  "online_desde" TIMESTAMP,
  "aceitou_termos" BOOLEAN DEFAULT false,
  "data_aceite_termos" TIMESTAMP,
  "ip_aceite_termos" TEXT,
  "versao_termos" TEXT DEFAULT '1.0'::text,
  "cpf" TEXT,
  "renavam" TEXT,
  "crlv_base64" TEXT,
  "cnh_frente_base64" TEXT,
  "cnh_verso_base64" TEXT,
  "cnh_digital_base64" TEXT,
  "lider_id" TEXT,
  "codigo_indicacao" TEXT,
  "balance_due" DOUBLE PRECISION DEFAULT 0,
  "chave_pix" TEXT,
  "tipo_chave_pix" TEXT,
  "cep" TEXT,
  "logradouro" TEXT,
  "numero" TEXT,
  "complemento" TEXT,
  "bairro" TEXT,
  "cidade" TEXT,
  "estado" TEXT,
  "email" TEXT,
  "data_nascimento" DATE,
  "mobihub_id" TEXT,
  "balance_due_blocked_at" TIMESTAMP,
  "balance_due_charge_id" TEXT,
  "balance_due_charge_pix" TEXT,
  "aceite_arbitragem" BOOLEAN DEFAULT false,
  "bloqueado_agendamento_ate" TIMESTAMP,
  "hash_aceite_termos" TEXT,
  PRIMARY KEY ("id")
);

-- Tabela: feriados
CREATE TABLE IF NOT EXISTS "feriados" (
  "id" INTEGER NOT NULL DEFAULT nextval('feriados_id_seq'::regclass),
  "data" DATE NOT NULL,
  "nome" TEXT NOT NULL,
  "tipo" TEXT DEFAULT 'nacional'::text,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "horario_inicio" TIME WITHOUT TIME ZONE,
  "horario_fim" TIME WITHOUT TIME ZONE,
  "valor_minimo" DOUBLE PRECISION,
  "valor_km" DOUBLE PRECISION,
  "km_minimo" DOUBLE PRECISION,
  PRIMARY KEY ("id")
);

-- Tabela: gateway_config
CREATE TABLE IF NOT EXISTS "gateway_config" (
  "id" INTEGER NOT NULL DEFAULT nextval('gateway_config_id_seq'::regclass),
  "gateway" TEXT DEFAULT 'zighu'::text,
  "url" TEXT DEFAULT 'https://zighu-pay-1.onrender.com'::text,
  "api_key" TEXT DEFAULT 'zighu_2026'::text,
  "ativo" BOOLEAN DEFAULT false,
  "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- Tabela: ratings
CREATE TABLE IF NOT EXISTS "ratings" (
  "id" INTEGER NOT NULL DEFAULT nextval('ratings_id_seq'::regclass),
  "ride_id" INTEGER,
  "estrelas_motorista" INTEGER,
  "comentario_cliente" TEXT,
  "avaliado_em_cliente" TIMESTAMP,
  "estrelas_cliente" INTEGER,
  "comentario_motorista" TEXT,
  "avaliado_em_motorista" TIMESTAMP,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- Tabela: ride_messages
CREATE TABLE IF NOT EXISTS "ride_messages" (
  "id" INTEGER NOT NULL DEFAULT nextval('ride_messages_id_seq'::regclass),
  "ride_id" INTEGER,
  "remetente" TEXT NOT NULL,
  "mensagem" TEXT NOT NULL,
  "lida" INTEGER DEFAULT 0,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- Tabela: ride_stops
CREATE TABLE IF NOT EXISTS "ride_stops" (
  "id" INTEGER NOT NULL DEFAULT nextval('ride_stops_id_seq'::regclass),
  "ride_id" INTEGER,
  "iniciada_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "finalizada_at" TIMESTAMP,
  "duracao_min" DOUBLE PRECISION,
  "custo" DOUBLE PRECISION DEFAULT 0,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- Tabela: ride_track
CREATE TABLE IF NOT EXISTS "ride_track" (
  "id" INTEGER NOT NULL DEFAULT nextval('ride_track_id_seq'::regclass),
  "ride_id" INTEGER,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- Tabela: rides
CREATE TABLE IF NOT EXISTS "rides" (
  "id" INTEGER NOT NULL DEFAULT nextval('rides_id_seq'::regclass),
  "token" TEXT NOT NULL,
  "client_id" INTEGER,
  "driver_id" INTEGER,
  "origem" TEXT NOT NULL,
  "origem_lat" DOUBLE PRECISION,
  "origem_lng" DOUBLE PRECISION,
  "destino" TEXT NOT NULL,
  "destino_lat" DOUBLE PRECISION,
  "destino_lng" DOUBLE PRECISION,
  "valor" DOUBLE PRECISION NOT NULL,
  "valor_motorista" DOUBLE PRECISION,
  "valor_mobihub" DOUBLE PRECISION,
  "status" TEXT DEFAULT 'aberta'::text,
  "tipo" TEXT DEFAULT 'normal'::text,
  "maps_link" TEXT,
  "telegram_message_id" TEXT,
  "agendada_para" TIMESTAMP,
  "disparada_at" TIMESTAMP,
  "concluida_auto" INTEGER DEFAULT 0,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "aceita_at" TIMESTAMP,
  "concluida_at" TIMESTAMP,
  "cancelada_at" TIMESTAMP,
  "status_detalhe" TEXT DEFAULT 'normal'::text,
  "motorista_chegou_at" TIMESTAMP,
  "passageiro_embarcou_at" TIMESTAMP,
  "tempo_espera_inicial_min" DOUBLE PRECISION DEFAULT 0,
  "custo_espera_inicial" DOUBLE PRECISION DEFAULT 0,
  "tempo_paradas_total_min" DOUBLE PRECISION DEFAULT 0,
  "custo_paradas" DOUBLE PRECISION DEFAULT 0,
  "num_paradas" INTEGER DEFAULT 0,
  "valor_final" DOUBLE PRECISION,
  "cancelado_por_espera" INTEGER DEFAULT 0,
  "taxa_cancelamento" DOUBLE PRECISION DEFAULT 0,
  "base_value" DOUBLE PRECISION DEFAULT 0,
  "wait_extra_minutes" DOUBLE PRECISION DEFAULT 0,
  "wait_extra_charge" DOUBLE PRECISION DEFAULT 0,
  "stop_extra_minutes" DOUBLE PRECISION DEFAULT 0,
  "stop_extra_charge" DOUBLE PRECISION DEFAULT 0,
  "total_value" DOUBLE PRECISION DEFAULT 0,
  "cancelado_por" TEXT,
  "forma_pagamento" TEXT DEFAULT 'dinheiro'::text,
  "valor_lider" DOUBLE PRECISION DEFAULT 0,
  "zighu_payment_id" TEXT,
  "zighu_payment_link" TEXT,
  "zighu_pix_qrcode" TEXT,
  "zighu_pix_payload" TEXT,
  "pagamento_status" TEXT DEFAULT 'pendente'::text,
  "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "km_reais" DOUBLE PRECISION,
  "sinal_valor" DOUBLE PRECISION DEFAULT 0,
  "sinal_charge_id" TEXT,
  "sinal_pix_payload" TEXT,
  "sinal_pago" BOOLEAN DEFAULT false,
  "sinal_estornado" BOOLEAN DEFAULT false,
  "alerta_30min_enviado" TIMESTAMP,
  "hash_sha256" TEXT,
  PRIMARY KEY ("id")
);

-- Tabela: split_rules
CREATE TABLE IF NOT EXISTS "split_rules" (
  "id" INTEGER NOT NULL DEFAULT nextval('split_rules_id_seq'::regclass),
  "nome" TEXT NOT NULL,
  "categoria" TEXT DEFAULT 'padrao'::text,
  "percentual_plataforma" DOUBLE PRECISION DEFAULT 15,
  "percentual_lider" DOUBLE PRECISION DEFAULT 2,
  "percentual_motorista" DOUBLE PRECISION DEFAULT 83,
  "ativo" INTEGER DEFAULT 1,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "com_lider" BOOLEAN DEFAULT false,
  PRIMARY KEY ("id")
);

-- Tabela: tarifas
CREATE TABLE IF NOT EXISTS "tarifas" (
  "id" INTEGER NOT NULL DEFAULT nextval('tarifas_id_seq'::regclass),
  "nome" TEXT NOT NULL,
  "dias" TEXT NOT NULL,
  "hora_inicio" TEXT NOT NULL,
  "hora_fim" TEXT NOT NULL,
  "valor_minimo" DOUBLE PRECISION NOT NULL,
  "valor_km" DOUBLE PRECISION DEFAULT 2.00,
  "km_minimo" DOUBLE PRECISION DEFAULT 7.5,
  "ativo" INTEGER DEFAULT 1,
  "aplicar_feriados" BOOLEAN DEFAULT false,
  PRIMARY KEY ("id")
);

-- Tabela: termos_versoes
CREATE TABLE IF NOT EXISTS "termos_versoes" (
  "id" INTEGER NOT NULL DEFAULT nextval('termos_versoes_id_seq'::regclass),
  "versao" VARCHAR(10) NOT NULL,
  "tipo" VARCHAR(20) NOT NULL,
  "titulo" TEXT NOT NULL,
  "conteudo" TEXT NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- Tabela: vehicles
CREATE TABLE IF NOT EXISTS "vehicles" (
  "id" INTEGER NOT NULL DEFAULT nextval('vehicles_id_seq'::regclass),
  "driver_id" INTEGER,
  "modelo" TEXT NOT NULL,
  "ano" TEXT NOT NULL,
  "cor" TEXT NOT NULL,
  "placa" TEXT NOT NULL,
  "ativo" INTEGER DEFAULT 0,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- Tabela: webhook_logs
CREATE TABLE IF NOT EXISTS "webhook_logs" (
  "id" INTEGER NOT NULL DEFAULT nextval('webhook_logs_id_seq'::regclass),
  "webhook_id" INTEGER,
  "evento" TEXT,
  "payload" TEXT,
  "resposta" TEXT,
  "status_code" INTEGER,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- Tabela: webhooks
CREATE TABLE IF NOT EXISTS "webhooks" (
  "id" INTEGER NOT NULL DEFAULT nextval('webhooks_id_seq'::regclass),
  "nome" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "evento" TEXT NOT NULL,
  "ativo" INTEGER DEFAULT 1,
  "secret_key" TEXT,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);