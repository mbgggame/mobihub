import pg from 'pg' 
import bcrypt from 'bcrypt' 
 
const { Pool } = pg 
 
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: process.env.DATABASE_URL?.includes('render.com') 
    ? { rejectUnauthorized: false } 
    : false 
}) 
 
export const query = (text, params) => pool.query(text, params) 
 
export async function initDB() { 
  await pool.query(` 
    CREATE TABLE IF NOT EXISTS admins ( 
      id SERIAL PRIMARY KEY, 
      email TEXT UNIQUE NOT NULL, 
      senha_hash TEXT NOT NULL, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ); 
 
    CREATE TABLE IF NOT EXISTS drivers ( 
      id SERIAL PRIMARY KEY, 
      nome TEXT NOT NULL, 
      telefone TEXT, 
      telegram_id TEXT, 
      modelo_carro TEXT NOT NULL, 
      ano_carro TEXT NOT NULL, 
      cor_carro TEXT NOT NULL, 
      placa TEXT NOT NULL, 
      total_viagens INTEGER DEFAULT 0, 
      media_avaliacao DOUBLE PRECISION DEFAULT 0, 
      total_avaliacoes INTEGER DEFAULT 0, 
      ativo INTEGER DEFAULT 1, 
      foto_base64 TEXT, 
      token_perfil TEXT, 
      lider_id INTEGER,
      balance_due DOUBLE PRECISION DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ); 
 
    CREATE TABLE IF NOT EXISTS clients ( 
      id SERIAL PRIMARY KEY, 
      telefone TEXT UNIQUE NOT NULL, 
      nome TEXT, 
      email TEXT, 
      total_corridas INTEGER DEFAULT 0, 
      media_avaliacao DOUBLE PRECISION DEFAULT 0, 
      total_avaliacoes INTEGER DEFAULT 0, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ); 
 
    CREATE TABLE IF NOT EXISTS rides ( 
      id SERIAL PRIMARY KEY, 
      token TEXT UNIQUE NOT NULL, 
      client_id INTEGER REFERENCES clients(id), 
      driver_id INTEGER REFERENCES drivers(id), 
      origem TEXT NOT NULL, 
      origem_lat DOUBLE PRECISION, 
      origem_lng DOUBLE PRECISION, 
      destino TEXT NOT NULL, 
      destino_lat DOUBLE PRECISION, 
      destino_lng DOUBLE PRECISION, 
      valor DOUBLE PRECISION NOT NULL, 
      valor_motorista DOUBLE PRECISION, 
      valor_mobihub DOUBLE PRECISION, 
      status TEXT DEFAULT 'aberta', 
      tipo TEXT DEFAULT 'normal', 
      maps_link TEXT, 
      telegram_message_id TEXT, 
      agendada_para TIMESTAMP, 
      disparada_at TIMESTAMP, 
      concluida_auto INTEGER DEFAULT 0, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
      aceita_at TIMESTAMP, 
      concluida_at TIMESTAMP, 
      cancelada_at TIMESTAMP 
    ); 
 
    CREATE TABLE IF NOT EXISTS ratings ( 
      id SERIAL PRIMARY KEY, 
      ride_id INTEGER UNIQUE REFERENCES rides(id), 
      estrelas_motorista INTEGER CHECK(estrelas_motorista BETWEEN 1 AND 5), 
      comentario_cliente TEXT, 
      avaliado_em_cliente TIMESTAMP, 
      estrelas_cliente INTEGER CHECK(estrelas_cliente BETWEEN 1 AND 5), 
      comentario_motorista TEXT, 
      avaliado_em_motorista TIMESTAMP, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ); 
 
    CREATE TABLE IF NOT EXISTS driver_locations ( 
      id SERIAL PRIMARY KEY, 
      driver_id INTEGER REFERENCES drivers(id), 
      ride_id INTEGER REFERENCES rides(id), 
      lat DOUBLE PRECISION NOT NULL, 
      lng DOUBLE PRECISION NOT NULL, 
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ); 

    CREATE TABLE IF NOT EXISTS ride_track ( 
      id SERIAL PRIMARY KEY, 
      ride_id INTEGER REFERENCES rides(id), 
      lat DOUBLE PRECISION NOT NULL, 
      lng DOUBLE PRECISION NOT NULL, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ); 
    CREATE INDEX IF NOT EXISTS idx_ride_track_ride_id ON ride_track(ride_id); 

    CREATE TABLE IF NOT EXISTS configuracoes ( 
      chave TEXT PRIMARY KEY, 
      valor TEXT NOT NULL 
    ); 
 
    CREATE TABLE IF NOT EXISTS tarifas ( 
      id SERIAL PRIMARY KEY, 
      nome TEXT NOT NULL, 
      dias TEXT NOT NULL, 
      hora_inicio TEXT NOT NULL, 
      hora_fim TEXT NOT NULL, 
      valor_minimo DOUBLE PRECISION NOT NULL, 
      valor_km DOUBLE PRECISION DEFAULT 2.00, 
      km_minimo DOUBLE PRECISION DEFAULT 7.5, 
      ativo INTEGER DEFAULT 1 
    ); 
  `) 
 
  await query(` 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS status_cadastro TEXT DEFAULT 'aprovado'; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS token_convite TEXT; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS convite_expira_em TIMESTAMP; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS motivo_reprovacao TEXT; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS online INTEGER DEFAULT 0; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS online_desde TIMESTAMP; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS aceitou_termos BOOLEAN DEFAULT false;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS data_aceite_termos TIMESTAMP;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS ip_aceite_termos TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS versao_termos TEXT DEFAULT '1.0';
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS aceite_arbitragem BOOLEAN DEFAULT FALSE;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cpf TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS renavam TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS crlv_base64 TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cnh_frente_base64 TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cnh_verso_base64 TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cnh_digital_base64 TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS chave_pix TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS tipo_chave_pix TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS asaas_id TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cep TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS logradouro TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS numero TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS complemento TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bairro TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cidade TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS estado TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS data_nascimento DATE;
    
    -- Remove unique constraint on telegram_id (allow same ID for client -> driver)
    ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_telegram_id_key;
    ALTER TABLE drivers ALTER COLUMN telegram_id DROP NOT NULL;
  `) 
 
  await query(` 
    CREATE TABLE IF NOT EXISTS convites ( 
      id SERIAL PRIMARY KEY, 
      token TEXT UNIQUE NOT NULL, 
      expira_em TIMESTAMP NOT NULL, 
      usado BOOLEAN DEFAULT false, 
      usado_em TIMESTAMP, 
      driver_id INTEGER REFERENCES drivers(id), 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ) 
  `) 
 
  await query(` 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS status_detalhe TEXT DEFAULT 'normal'; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS motorista_chegou_at TIMESTAMP; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS passageiro_embarcou_at TIMESTAMP; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS tempo_espera_inicial_min DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS custo_espera_inicial DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS tempo_paradas_total_min DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS custo_paradas DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS num_paradas INTEGER DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS valor_final DOUBLE PRECISION; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancelado_por_espera INTEGER DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS taxa_cancelamento DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancelado_por TEXT;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS forma_pagamento TEXT DEFAULT '1';
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS valor_lider DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS balance_due DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lider_id INTEGER;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS balance_due DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS aceitou_termos BOOLEAN DEFAULT FALSE;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS data_aceite_termos TIMESTAMP;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS ip_aceite_termos VARCHAR(50);
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS versao_termos VARCHAR(10);
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS aceite_responsabilidade BOOLEAN DEFAULT FALSE;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;

    -- Campos de Memória de Cálculo (Transparência Billing) 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS base_value DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS wait_extra_minutes DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS wait_extra_charge DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS stop_extra_minutes DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS stop_extra_charge DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS total_value DOUBLE PRECISION DEFAULT 0; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS asaas_payment_id TEXT; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS asaas_payment_link TEXT; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS asaas_pix_qrcode TEXT; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS asaas_pix_payload TEXT; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS pagamento_status TEXT DEFAULT 'pendente'; 
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS km_reais DOUBLE PRECISION; 
    ALTER TABLE tarifas ADD COLUMN IF NOT EXISTS aplicar_feriados BOOLEAN DEFAULT false;
    ALTER TABLE feriados ADD COLUMN IF NOT EXISTS horario_inicio TIME;
    ALTER TABLE feriados ADD COLUMN IF NOT EXISTS horario_fim TIME;
    ALTER TABLE feriados ADD COLUMN IF NOT EXISTS valor_minimo DOUBLE PRECISION;
    ALTER TABLE feriados ADD COLUMN IF NOT EXISTS valor_km DOUBLE PRECISION;
    ALTER TABLE feriados ADD COLUMN IF NOT EXISTS km_minimo DOUBLE PRECISION;

    DO $$ BEGIN 
      IF NOT EXISTS ( 
        SELECT 1 FROM pg_constraint WHERE conname = 'feriados_data_nome_unique' 
      ) THEN 
        ALTER TABLE feriados ADD CONSTRAINT feriados_data_nome_unique UNIQUE (data, nome); 
      END IF; 
    END $$;
  `)

  await query(` 
    CREATE TABLE IF NOT EXISTS ride_stops ( 
      id SERIAL PRIMARY KEY, 
      ride_id INTEGER REFERENCES rides(id), 
      iniciada_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
      finalizada_at TIMESTAMP, 
      duracao_min DOUBLE PRECISION, 
      custo DOUBLE PRECISION DEFAULT 0, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ) 
  `) 
 
  await query(` 
    CREATE TABLE IF NOT EXISTS vehicles ( 
      id SERIAL PRIMARY KEY, 
      driver_id INTEGER REFERENCES drivers(id) ON DELETE CASCADE, 
      modelo TEXT NOT NULL, 
      ano TEXT NOT NULL, 
      cor TEXT NOT NULL, 
      placa TEXT NOT NULL, 
      ativo INTEGER DEFAULT 0, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ) 
  `) 
 
  await query(` 
    CREATE TABLE IF NOT EXISTS ride_messages ( 
      id SERIAL PRIMARY KEY, 
      ride_id INTEGER REFERENCES rides(id), 
      remetente TEXT NOT NULL CHECK(remetente IN ('motorista', 'passageiro')), 
      mensagem TEXT NOT NULL, 
      lida INTEGER DEFAULT 0, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ); 

    CREATE TABLE IF NOT EXISTS driver_transactions ( 
      id SERIAL PRIMARY KEY, 
      driver_id INTEGER REFERENCES drivers(id), 
      ride_id INTEGER REFERENCES rides(id), 
      tipo TEXT NOT NULL, 
      descricao TEXT NOT NULL, 
      valor DOUBLE PRECISION NOT NULL, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_driver_ride_tipo UNIQUE (driver_id, ride_id, tipo)
    );

    CREATE TABLE IF NOT EXISTS feriados (
      id SERIAL PRIMARY KEY,
      data DATE NOT NULL,
      nome TEXT NOT NULL,
      tipo TEXT DEFAULT 'nacional',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  try {
    // Limpar registros duplicados ou conflitantes antes de corrigir datas
    await query(`DELETE FROM feriados WHERE nome ILIKE '%Coloniza%' AND data = '2026-05-22'`)
    await query(`DELETE FROM feriados WHERE nome ILIKE '%Independ%' AND data = '2026-09-06'`)
    await query(`DELETE FROM feriados WHERE nome ILIKE '%João Batista%' AND data = '2026-06-23'`)
    await query(`DELETE FROM feriados WHERE nome ILIKE '%Pedro%' AND nome ILIKE '%Serra%' AND data = '2026-06-28'`)
    await query(`DELETE FROM feriados WHERE nome ILIKE '%Viana%' AND data = '2026-07-22'`)

    // Corrigir datas erradas de feriados existentes
    await query(`UPDATE feriados SET data = '2026-05-23' WHERE nome ILIKE '%Coloniza%' AND data != '2026-05-23';`)
    await query(`UPDATE feriados SET data = '2026-09-07' WHERE nome ILIKE '%Independ%' AND data != '2026-09-07';`)
    await query(`UPDATE feriados SET data = '2026-06-24' WHERE nome ILIKE '%João Batista%' AND data != '2026-06-24';`)
    await query(`UPDATE feriados SET data = '2026-06-29' WHERE nome ILIKE '%Pedro%' AND nome ILIKE '%Serra%' AND data != '2026-06-29';`)
    await query(`UPDATE feriados SET data = '2026-07-23' WHERE nome ILIKE '%Viana%' AND data != '2026-07-23';`)

    // Inserir apenas feriados que não existem ainda
    await query(`
      INSERT INTO feriados (data, nome, tipo) VALUES
        ('2026-01-01', 'Ano Novo', 'nacional'),
        ('2026-03-02', 'Carnaval (Segunda-feira)', 'nacional'),
        ('2026-03-03', 'Carnaval (Terça-feira)', 'nacional'),
        ('2026-03-04', 'Quarta de Cinzas', 'nacional'),
        ('2026-04-03', 'Sexta-Feira Santa', 'nacional'),
        ('2026-04-05', 'Páscoa', 'nacional'),
        ('2026-04-21', 'Tiradentes', 'nacional'),
        ('2026-05-01', 'Dia do Trabalho', 'nacional'),
        ('2026-06-04', 'Corpus Christi', 'nacional'),
        ('2026-09-07', 'Independência do Brasil', 'nacional'),
        ('2026-10-12', 'Nossa Senhora Aparecida', 'nacional'),
        ('2026-11-02', 'Finados', 'nacional'),
        ('2026-11-15', 'Proclamação da República', 'nacional'),
        ('2026-11-20', 'Consciência Negra', 'nacional'),
        ('2026-12-25', 'Natal', 'nacional'),
        ('2026-04-13', 'Nossa Senhora da Penha (Padroeira do ES)', 'estadual'),
        ('2026-05-23', 'Colonização do Solo Espírito-Santense', 'estadual'),
        ('2026-04-03', 'Paixão de Cristo (Vitória)', 'municipal'),
        ('2026-06-04', 'Corpus Christi (Vitória)', 'municipal'),
        ('2026-09-08', 'Nossa Senhora da Vitória / Aniversário de Vitória', 'municipal'),
        ('2026-04-03', 'Paixão de Cristo (Vila Velha)', 'municipal'),
        ('2026-05-23', 'Colonização do Solo ES (Vila Velha)', 'municipal'),
        ('2026-06-29', 'São Pedro (Serra)', 'municipal'),
        ('2026-12-08', 'Nossa Senhora da Conceição (Serra)', 'municipal'),
        ('2026-12-26', 'Dia do Serrano (Serra)', 'municipal'),
        ('2026-04-03', 'Paixão de Cristo (Cariacica)', 'municipal'),
        ('2026-06-04', 'Corpus Christi (Cariacica)', 'municipal'),
        ('2026-06-24', 'São João Batista (Cariacica)', 'municipal'),
        ('2026-07-23', 'Aniversário de Viana', 'municipal'),
        ('2026-12-08', 'Nossa Senhora da Conceição (Viana)', 'municipal')
      ON CONFLICT (data, nome) DO NOTHING
    `)
  } catch(e) {
    console.error('[FERIADOS SEED ERROR]', e.message)
  } 

  await query(` 
    -- Campo líder no cadastro do motorista 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lider_id TEXT; 
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS codigo_indicacao TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS mobihub_id TEXT UNIQUE;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS balance_due_blocked_at TIMESTAMP;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS balance_due_charge_id TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS balance_due_charge_pix TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT; 
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS cpf TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS telegram_id TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS balance_due_charge_id TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS balance_due_charge_link TEXT;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS hash_sha256 TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS hash_aceite_termos TEXT;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS hash_aceite_termos TEXT;

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_driver_ride_tipo'
      ) THEN
        ALTER TABLE driver_transactions ADD CONSTRAINT unique_driver_ride_tipo UNIQUE (driver_id, ride_id, tipo);
      END IF;
    END $$;
  `)

  try { 
    // Gerar IDs MobiHub para motoristas já cadastrados na ordem do id
    const existingDrivers = (await query('SELECT id FROM drivers WHERE mobihub_id IS NULL ORDER BY id')).rows
    for (let i = 0; i < existingDrivers.length; i++) {
      const num = i + 1
      const mobihubId = `ZH-VIX-${String(num).padStart(4, '0')}`
      await query('UPDATE drivers SET mobihub_id = $1 WHERE id = $2', [mobihubId, existingDrivers[i].id])
    }
  } catch(e) { 
    console.log('[MOBIHUB_ID] Já existem IDs gerados:', e.message) 
  }

  await query(` 
    -- Tabela de configurações de webhook 
    CREATE TABLE IF NOT EXISTS webhooks ( 
      id SERIAL PRIMARY KEY, 
      nome TEXT NOT NULL, 
      url TEXT NOT NULL, 
      evento TEXT NOT NULL, 
      ativo INTEGER DEFAULT 1, 
      secret_key TEXT, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ); 

    -- Tabela de regras de split financeiro 
    CREATE TABLE IF NOT EXISTS split_rules ( 
      id SERIAL PRIMARY KEY, 
      nome TEXT NOT NULL, 
      categoria TEXT DEFAULT 'padrao', 
      percentual_plataforma DOUBLE PRECISION DEFAULT 15, 
      percentual_lider DOUBLE PRECISION DEFAULT 2, 
      percentual_motorista DOUBLE PRECISION DEFAULT 83, 
      com_lider BOOLEAN DEFAULT false, 
      ativo INTEGER DEFAULT 1, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ); 

    -- Tabela de log de webhooks disparados 
    CREATE TABLE IF NOT EXISTS webhook_logs ( 
      id SERIAL PRIMARY KEY, 
      webhook_id INTEGER, 
      evento TEXT, 
      payload TEXT, 
      resposta TEXT, 
      status_code INTEGER, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    ); 

    -- Tabela de configuração de gateway de pagamentos
    CREATE TABLE IF NOT EXISTS gateway_config (
      id SERIAL PRIMARY KEY,
      gateway TEXT DEFAULT 'asaas',
      url TEXT DEFAULT 'https://zighu-pay-1.onrender.com',
      api_key TEXT DEFAULT 'zighu_2026',
      ativo BOOLEAN DEFAULT false,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS termos_versoes (
      id SERIAL PRIMARY KEY,
      versao VARCHAR(10) UNIQUE NOT NULL,
      tipo VARCHAR(20) NOT NULL,
      titulo TEXT NOT NULL,
      conteudo TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `) 
 
  // Inserir configuração padrão de gateway se não existir
  await query(`
    INSERT INTO gateway_config (gateway, url, api_key, ativo) 
    SELECT 'asaas', '', '', false 
    WHERE NOT EXISTS (SELECT 1 FROM gateway_config)
  `)

  // Migra veículos existentes dos motoristas para a nova tabela 
  await query(` 
    INSERT INTO vehicles (driver_id, modelo, ano, cor, placa, ativo) 
    SELECT id, modelo_carro, ano_carro, cor_carro, placa, 1 
    FROM drivers 
    WHERE modelo_carro IS NOT NULL 
    AND id NOT IN (SELECT DISTINCT driver_id FROM vehicles) 
  `) 
 
  await query(` 
    INSERT INTO configuracoes (chave, valor) VALUES 
      ('espera_taxa_cancelamento', '10.00'), 
      ('espera_minutos_gratis', '3'), 
      ('espera_valor_minuto', '0.60'), 
      ('espera_max_cancelamento', '10'), 
      ('parada_minutos_gratis', '5'), 
      ('parada_valor_minuto', '0.60'), 
      ('parada_auto_metros', '50'), 
      ('parada_auto_segundos', '60'),
      ('motorista_balance_due_limite', '30.00') 
      ON CONFLICT (chave) DO NOTHING 
  `) 
 
  await seedAdmin() 
  await seedConfigs() 
  await seedTarifas()

  // Inserir termos oficiais
  const textoTermoPassageiro = `TERMOS E CONDIÇÕES DE USO DA PLATAFORMA MOBIHUB – VERSÃO PASSAGEIRO
Última atualização: Maio de 2026. Este instrumento rege a relação jurídica entre a ELVIVA GROUP LTDA e o Passageiro. O aceite eletrônico é condição mandatória para acesso e utilização do aplicativo MobiHub.

CLÁUSULA 1 – DAS PARTES CONTRATANTES
1.1. PROVEDORA: ELVIVA GROUP LTDA, sediada na Rua Joaquim Lírio, nº 237, Apt 1302-3 VG, Praia do Canto, Vitória - ES, CEP 29.055-460, CNPJ 62.444.354/0001-82, titular dos direitos sobre a plataforma MobiHub.
1.2. PASSAGEIRO: Pessoa física plenamente capaz, devidamente cadastrada na plataforma, que utiliza o software para conectar-se a prestadores autônomos de serviços de transporte.

CLÁUSULA 2 – DA NATUREZA JURÍDICA DO SERVIÇO
2.1. A MobiHub atua exclusivamente como licenciadora de software (marketplace tecnológico), conforme CNAE 74.90-1-04.
2.2. A MobiHub NÃO é empresa de transporte, não possui frota, não atua como seguradora e não exerce atividade de transportadora.
2.3. O contrato de transporte é celebrado única e exclusivamente entre o Passageiro e o Motorista Parceiro Autônomo. O serviço da MobiHub encerra-se no exato instante em que a conexão tecnológica entre as partes é consolidada.

CLÁUSULA 3 – DA EXCLUSÃO DE RESPONSABILIDADE CIVIL
3.1. A MobiHub fica integralmente isenta de responsabilidade por danos decorrentes do trajeto, incluindo:
a) Acidentes, colisões, mortes, invalidez ou lesões corporais durante o deslocamento;
b) Roubos, assaltos, agressões físicas, verbais ou psicológicas praticadas por motoristas ou terceiros;
c) Delitos contra a dignidade sexual, assédio ou importunação no interior do veículo;
d) Perda, furto, esquecimento ou extravio de pertences no veículo;
e) Atrasos, perda de voos, compromissos profissionais ou lucros cessantes.

CLÁUSULA 4 – DA LIMITAÇÃO INDENIZATÓRIA
4.1. Na hipótese de condenação por falha técnica exclusiva do software, o valor máximo de indenização estará limitado ao valor pago pela corrida geradora da controvérsia ou ao teto de R$ 200,00, aplicando-se o menor valor.

CLÁUSULA 5 – DA RESPONSABILIDADE DO PASSAGEIRO
5.1. O Passageiro é responsável por danos materiais, avarias, vandalismo ou higienização extraordinária (incluindo vômito) causados ao veículo do Motorista.
5.2. O Passageiro autoriza expressamente a MobiHub a efetuar débitos automáticos no cartão cadastrado para ressarcimento do motorista lesado, sem necessidade de autorização prévia.

CLÁUSULA 6 – DA TARIFA E CANCELAMENTO
6.1. A MobiHub utiliza algoritmos de preço dinâmico que podem flutuar conforme oferta, demanda e condições de mercado.
6.2. O cancelamento após o prazo de tolerância configurado no aplicativo (contado da aceitação pelo motorista) gerará cobrança automática de Taxa de Cancelamento.

CLÁUSULA 7 – CONDUTA E DESATIVAÇÃO DA CONTA
7.1. O Passageiro deve portar-se de modo respeitoso, usar cinto de segurança e não transportar substâncias ilícitas ou armas.
7.2. A MobiHub pode suspender ou desativar a conta do Passageiro sem aviso prévio e sem direito a indenização em caso de: fraudes, perfis falsos, chargebacks indevidos, assédio ou descumprimento destes termos.

CLÁUSULA 8 – DO FORO DE ELEIÇÃO
8.1. Fica eleito o Foro da Comarca de Vitória/ES para dirimir controvérsias, ressalvadas as hipóteses de competência absoluta previstas na legislação consumerista.`

  const textoTermoMotorista = `CONTRATO DE LICENCIAMENTO DE SOFTWARE E INTERMEDIAÇÃO DE NEGÓCIOS DIGITAIS

1. Das Partes Contratantes
De um lado, ELVIVA GROUP LTDA, pessoa jurídica de direito privado, sediada na Rua Joaquim Lírio, nº 237, Apt 1302-3 VG, Praia do Canto, Vitória - ES, CEP 29.055-460, inscrita no CNPJ sob o nº 62.444.354/0001-82, doravante denominada simplesmente MobiHub; e, de outro lado, o Motorista Parceiro, profissional autônomo e independente, devidamente cadastrado e aprovado na plataforma.

2. Da Natureza do Serviço: Intermediação Pura e Natureza Civil
2.1. A MobiHub fornece exclusivamente uma licença de uso de software (aplicativo) para intermediação e agenciamento de negócios (CNAE 74.90-1-04).
2.2. A MobiHub não presta serviços de transporte, não possui frota de veículos, não atua como seguradora e não é concessionária de serviço público.
2.3. O presente contrato possui natureza estritamente cível e comercial. O Motorista Parceiro reconhece que a MobiHub é uma plataforma tecnológica de marketplace e que o cliente final do motorista é o Passageiro, e não a MobiHub.

3. Da Inexistência de Vínculo Empregatício, Subordinação e Indícios Trabalhistas
3.1. O Motorista Parceiro declara estar ciente de que atua como prestador de serviços estritamente autônomo e independente.
3.2. Não há qualquer relação de subordinação, habitualidade, exclusividade ou dependência econômica entre o Motorista Parceiro e a MobiHub.
3.3. O Motorista Parceiro possui total autonomia para definir seus dias, horários e locais de trabalho, bem como ligar ou desligar o aplicativo quando lhe convier, sem qualquer penalidade por ociosidade.
3.4. O Motorista Parceiro poderá cadastrar-se, prestar serviços e utilizar simultaneamente quaisquer outros aplicativos de tecnologia ou plataformas concorrentes no mercado, inexistindo obrigação de exclusividade.
3.5. O Motorista Parceiro é o único responsável por determinar sua própria estratégia comercial, rotas de navegação e aceitação ou recusa de chamadas, não recebendo ordens, diretrizes de produtividade mínima ou fiscalização de jornada por parte da MobiHub.

4. Da Indenidade e Blindagem de Responsabilidade Civil, Trabalhista e Criminal
4.1. O Motorista Parceiro obriga-se a manter a MobiHub isenta de qualquer reclamação trabalhista, cível, fiscal, previdenciária ou criminal que venha a ser discutida em juízo ou fora dele.
4.2. Caso a MobiHub seja demandada judicialmente por atos praticados pelo Motorista Parceiro (incluindo acidentes, multas, discussões de vínculo, assédio ou agressões), o Motorista autoriza a sua denunciação à lide, chamamento ao processo ou assunção imediata do polo passivo, arcando integralmente com os custos advocatícios, custas processuais, depósitos recursais e eventuais condenações.
4.3. A responsabilidade por qualquer dano material, moral, estético ou corporal causado aos Passageiros ou a terceiros durante a execução do transporte é exclusiva e integral do Motorista Parceiro.

5. Das Obrigações do Motorista Parceiro e Requisitos de Segurança
5.1. Manter o veículo automotor com a manutenção preventiva em dia, limpo e com toda a documentação regularizada (CRLV e CNH com observação EAR).
5.2. Arcar com todos os custos operacionais da sua atividade, tais como combustível, seguro de terceiros (APP), impostos, internet móvel e depreciação do bem.
5.3. Manter ativa, válida e integralmente paga uma apólice de seguro de Responsabilidade Civil de Passageiros (Seguro APP - Acidentes Pessoais a Passageiros), sob pena de descredenciamento imediato.

6. Da Taxa de Intermediação e Repasses Financeiros
6.1. Pelo serviço de intermediação tecnológica, o Motorista Parceiro pagará à MobiHub uma taxa de intermediação por corrida realizada, retida diretamente na fonte ou cobrada no fechamento dos repasses.
6.2. A MobiHub atua como mera mandatária do Motorista Parceiro para fins de facilitação de pagamento, recebendo os valores pagos pelos Passageiros via cartão/PIX e repassando-os ao Motorista após deduzida a taxa de intermediação.

7. Da Rescisão, Suspensão e Desativação da Conta
7.1. Este contrato poderá ser rescindido por qualquer das partes, a qualquer momento, sem direito a indenização, mediante o simples encerramento da conta no aplicativo ou notificação digital.
7.2. A MobiHub reserva-se o direito de suspender temporariamente ou desativar definitivamente a conta do Motorista Parceiro, sem aviso prévio e sem que caiba qualquer indenização por lucros cessantes, em caso de: a) Desrespeito aos critérios mínimos de avaliação; b) Suspeita de fraudes tecnológicas; c) Violação de segurança, assédio ou violência; d) Descumprimento de qualquer cláusula deste instrumento.

CLÁUSULA 8 — CLÁUSULA COMPROMISSÓRIA DE ARBITRAGEM (DESTAQUE OBRIGATÓRIO)
O MOTORISTA PARCEIRO DECLARA CONCORDAR EXPRESSAMENTE QUE QUALQUER LITÍGIO, DISPUTA, DIVERGÊNCIA OU RECLAMAÇÃO DECORRENTE DESTE CONTRATO, DE SUA INTERPRETAÇÃO OU DE SUA EXECUÇÃO (INCLUINDO QUESTÕES SOBRE SUSPENSÃO OU BLOQUEIO DE CONTA), SERÁ RESOLVIDO DEFINITIVAMENTE POR MEIO DE ARBITRAGEM, RENUNCIANDO EXPRESSAMENTE AO DIREITO DE RECORRER À JUSTIÇA COMUM (PODER JUDICIÁRIO).
8.1. A arbitragem será administrada pela CAMARB (Câmara de Mediação e Arbitragem Empresarial - Brasil) ou pela Plataforma de Arbitragem Digital Arbtrato, conduzida de forma 100% eletrônica/online.
8.2. A sentença arbitral terá caráter definitivo, produzindo os mesmos efeitos de uma sentença judicial, sendo vinculante para ambas as partes.
8.3. O idioma oficial da arbitragem será o português e a lei aplicável será a legislação da República Federativa do Brasil.
8.4. As disputas serão resolvidas de forma estritamente individual, sendo proibida a instauração de arbitragens coletivas contra a MobiHub.`

  await query(`
    INSERT INTO termos_versoes (versao, tipo, titulo, conteudo) 
    VALUES 
      ('1.0', 'passageiro', 'TERMOS E CONDIÇÕES DE USO DA PLATAFORMA MOBIHUB – VERSÃO PASSAGEIRO', $1),
      ('2.1', 'motorista', 'CONTRATO DE LICENCIAMENTO DE SOFTWARE E INTERMEDIAÇÃO DE NEGÓCIOS DIGITAIS', $2)
    ON CONFLICT (versao) DO NOTHING
  `, [textoTermoPassageiro, textoTermoMotorista])

  // Adicionar coluna com_lider se não existir
  await query(`ALTER TABLE split_rules ADD COLUMN IF NOT EXISTS com_lider BOOLEAN DEFAULT false`)

  // Adicionar colunas para cartão de crédito e créditos
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS asaas_credit_card_token TEXT`)
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS asaas_credit_card_brand TEXT`)
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS asaas_credit_card_last_digits TEXT`)
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS creditos DOUBLE PRECISION DEFAULT 0`)

  // Agendamento com sinal (30%)
  await query(`
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS sinal_valor DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS sinal_charge_id TEXT;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS sinal_pix_payload TEXT;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS sinal_pago BOOLEAN DEFAULT FALSE;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS sinal_estornado BOOLEAN DEFAULT FALSE;
    ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bloqueado_agendamento_ate TIMESTAMP;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS alerta_30min_enviado TIMESTAMP;
  `)

  // Seed das regras de split padrão
  const splitExisting = await query('SELECT COUNT(*) as total FROM split_rules') 
  if (parseInt(splitExisting.rows[0].total) === 0) { 
    await query(`INSERT INTO split_rules (nome, categoria, percentual_plataforma, percentual_lider, percentual_motorista, com_lider, ativo) 
      VALUES 
        ('Padrão sem Líder', 'padrao', 18, 0, 82, false, 1),
        ('Padrão com Líder', 'padrao', 15, 3, 82, true, 1)`) 
  }

  console.log('[DB] PostgreSQL inicializado') 
} 
 
async function seedAdmin() { 
  const existing = await pool.query('SELECT id FROM admins LIMIT 1') 
  if (existing.rows.length > 0) return 
  const email = process.env.ADMIN_EMAIL || 'admin@mobihub.com' 
  const senha = process.env.ADMIN_SENHA || 'mobihub123' 
  const hash = await bcrypt.hash(senha, 10) 
  await pool.query('INSERT INTO admins (email, senha_hash) VALUES ($1, $2)', [email, hash]) 
  console.log(`[DB] Admin criado: ${email}`) 
} 
 
async function seedConfigs() { 
  const configs = { 
    'agendamento_disparo_imediato': 'true', 
    'agendamento_minutos_antes': '30', 
    'agendamento_bloqueio_ativo': 'true', 
    'agendamento_minutos_bloqueio': '60', 
    'corrida_valor_minimo': '15', 
    'corrida_km_minimo': '7.5', 
    'corrida_valor_km': '2', 
    'chegada_raio_metros': '150', 
    'chegada_auto_ativo': 'true',
    'parada_auto_metros': '50',
    'parada_auto_segundos': '60'
  } 
  for (const [chave, valor] of Object.entries(configs)) { 
    await pool.query( 
      'INSERT INTO configuracoes (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING', 
      [chave, valor] 
    ) 
  } 
} 
 
async function seedTarifas() { 
  const existing = await pool.query('SELECT COUNT(*) as total FROM tarifas') 
  if (parseInt(existing.rows[0].total) > 0) { 
    return; 
  }
  
  const tarifas = [ 
    ['Padrão', '1,2,3,4,5', '09:00', '17:00', 15.00, 2.50, 1.0], 
    ['Pico manhã', '1,2,3,4,5', '06:00', '09:00', 20.00, 3.00, 1.0], 
    ['Pico tarde', '1,2,3,4,5', '17:00', '20:00', 20.00, 3.00, 1.0], 
    ['Noturno', '0,1,2,3,4,5,6', '20:00', '06:00', 22.00, 3.50, 1.0], 
    ['Fim de semana', '0,6', '06:00', '20:00', 22.00, 3.50, 1.0], 
    ['Fim de semana noturno', '0,6', '20:00', '06:00', 25.00, 4.00, 1.0] 
  ] 
  
  for (const t of tarifas) { 
    await pool.query( 
      'INSERT INTO tarifas (nome, dias, hora_inicio, hora_fim, valor_minimo, valor_km, km_minimo) VALUES ($1, $2, $3, $4, $5, $6, $7)', 
      [t[0], t[1], t[2], t[3], t[4], t[5], t[6]] 
    ) 
  } 
} 
