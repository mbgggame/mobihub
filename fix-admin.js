
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, 'public', 'admin', 'motoristas.html');
let content = fs.readFileSync(filePath, 'utf8');

const oldStr = `          ${d.asaas_id ? \`<p><span class="font-medium">ID Asaas (walletId):</span> <span class="font-mono">\${d.asaas_id}</span></p>\` : ''}
        </div>`;
const newStr = `          ${d.asaas_id ? \`<p><span class="font-medium">ID Asaas (walletId):</span> <span class="font-mono">\${d.asaas_id}</span></p>\` : ''}
          <p><strong>Saldo Devedor:</strong> R$ \${parseFloat(d.balance_due || 0).toFixed(2)}</p>
        </div>`;

content = content.replace(oldStr, newStr);

fs.writeFileSync(filePath, content, 'utf8');
console.log('File fixed!');
