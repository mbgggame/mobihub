INSERT INTO configuracoes (chave, valor) 
VALUES ('usar_tarifa_feriado', 'true') 
ON CONFLICT (chave) DO NOTHING;
