import 'dotenv/config';
import { query } from '../src/db.js';

async function main() {
  try {
    console.log('Verificando config radar_vix_tempo_real...');
    const res = await query('SELECT * FROM configuracoes WHERE chave = $1', ['radar_vix_tempo_real']);
    if (res.rows.length === 0) {
      console.log('Criando config com valor false...');
      await query('INSERT INTO configuracoes (chave, valor) VALUES ($1, $2)', ['radar_vix_tempo_real', 'false']);
      console.log('✅ Config criada com sucesso!');
    } else {
      console.log('✅ Config já existe!');
    }
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  }
}

main();