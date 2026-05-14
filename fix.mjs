
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, 'public', 'motorista', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

const oldStr = "   } else if (corrida.status === 'concluida' && corrida.pagamento_status === 'aguardando_pagamento') {";
const newStr = `   } else if (corrida.status_detalhe === 'em_andamento' && (corrida.forma_pagamento === '1' || corrida.forma_pagamento === 1)) {
     qrCard.classList.add('hidden')
     receberDinheiroCard.classList.remove('hidden')
     pagamentoConfirmadoCard.classList.add('hidden')
   } else if (corrida.status === 'concluida' && corrida.pagamento_status === 'aguardando_pagamento') {`;

content = content.replace(oldStr, newStr);

fs.writeFileSync(filePath, content, 'utf8');
console.log('File fixed!');
