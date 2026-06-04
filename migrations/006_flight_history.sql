-- Migration 006: Histórico de voos VIX para relatório de demanda
-- Aplicar com: node scripts/migrate.js --prod

CREATE TABLE IF NOT EXISTS aircraft_capacity (
  aircraft_type  VARCHAR(10) PRIMARY KEY,
  description    TEXT NOT NULL,
  max_pax        INT NOT NULL,
  alert_level    VARCHAR(10) NOT NULL DEFAULT 'medium'
);

INSERT INTO aircraft_capacity VALUES
  ('A20N','Airbus A320neo',174,'high'),
  ('A319','Airbus A319',144,'high'),
  ('A320','Airbus A320',180,'high'),
  ('A321','Airbus A321',220,'high'),
  ('B738','Boeing 737-800',189,'high'),
  ('B737','Boeing 737',149,'high'),
  ('E295','Embraer E2-195',136,'medium'),
  ('E195','Embraer 195',118,'medium'),
  ('E190','Embraer 190',100,'medium'),
  ('E175','Embraer 175',78,'medium'),
  ('AT76','ATR 72-600',70,'low'),
  ('AT72','ATR 72',70,'low'),
  ('AT45','ATR 42',50,'low'),
  ('DH8D','Dash 8 Q400',78,'low')
ON CONFLICT (aircraft_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS flight_history (
  id             SERIAL PRIMARY KEY,
  flight_id      VARCHAR(60) UNIQUE,
  ident          VARCHAR(20),
  operator       VARCHAR(100),
  operator_iata  VARCHAR(5),
  operator_icao  VARCHAR(5),
  aircraft_type  VARCHAR(10),
  max_pax        INT,
  pax_estimado   INT,
  tipo           VARCHAR(10) NOT NULL,
  origem_iata    VARCHAR(5),
  destino_iata   VARCHAR(5),
  horario        TIMESTAMPTZ,
  horario_bsb    TIMESTAMPTZ,
  dia_semana     INT,
  hora_slot      INT,
  status         VARCHAR(30),
  collected_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fh_tipo     ON flight_history(tipo);
CREATE INDEX IF NOT EXISTS idx_fh_dia_hora ON flight_history(dia_semana, hora_slot);
CREATE INDEX IF NOT EXISTS idx_fh_operator ON flight_history(operator_iata);
CREATE INDEX IF NOT EXISTS idx_fh_horario  ON flight_history(horario_bsb);
