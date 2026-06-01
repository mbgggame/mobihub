-- Regiões de cobertura
CREATE TABLE IF NOT EXISTS regioes_cobertura (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  raio_km DOUBLE PRECISION NOT NULL DEFAULT 15,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO regioes_cobertura (nome, lat, lng, raio_km) VALUES
  ('Vitória', -20.3155, -40.3128, 15),
  ('Serra', -20.1286, -40.3083, 15),
  ('Vila Velha', -20.3297, -40.2920, 15),
  ('Guarapari', -20.6719, -40.5121, 15),
  ('Viana', -20.3897, -40.4936, 15),
  ('Aracruz', -19.8194, -40.2742, 15);

-- Config operacional
CREATE TABLE IF NOT EXISTS operacional_config (
  id SERIAL PRIMARY KEY,
  modo_teste BOOLEAN DEFAULT false,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO operacional_config DEFAULT VALUES;
