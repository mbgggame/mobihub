ALTER TABLE rides ADD COLUMN IF NOT EXISTS is_teste BOOLEAN DEFAULT false;
UPDATE rides SET is_teste = true WHERE created_at < '2026-06-01';
