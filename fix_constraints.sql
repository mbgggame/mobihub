-- Adiciona constraints que faltam no Supabase
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feriados_data_nome_unique'
  ) THEN
    ALTER TABLE feriados ADD CONSTRAINT feriados_data_nome_unique UNIQUE (data, nome);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_driver_ride_tipo'
  ) THEN
    ALTER TABLE driver_transactions ADD CONSTRAINT unique_driver_ride_tipo UNIQUE (driver_id, ride_id, tipo);
  END IF;
END $$;

-- Adiciona index que faltam
CREATE INDEX IF NOT EXISTS idx_ride_track_ride_id ON ride_track(ride_id);