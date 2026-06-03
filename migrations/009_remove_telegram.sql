-- Remove campos Telegram do banco
ALTER TABLE drivers DROP COLUMN IF EXISTS telegram_id;
ALTER TABLE clients DROP COLUMN IF EXISTS telegram_id;
ALTER TABLE rides DROP COLUMN IF EXISTS telegram_message_id;