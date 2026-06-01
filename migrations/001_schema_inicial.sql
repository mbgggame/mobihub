-- Rename columns from asaas_* to zighu_* in rides table
ALTER TABLE rides RENAME COLUMN asaas_pix_payload TO zighu_pix_payload;
ALTER TABLE rides RENAME COLUMN asaas_pix_qrcode TO zighu_pix_qrcode;
ALTER TABLE rides RENAME COLUMN asaas_payment_id TO zighu_payment_id;
ALTER TABLE rides RENAME COLUMN asaas_payment_link TO zighu_payment_link;
