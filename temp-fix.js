import fs from 'fs';

const filePath = 'c:\\MobiHub\\public\\motorista\\index.html';
let content = fs.readFileSync(filePath, 'utf8');

// First, fix the "Meu Extrato" button to remove the badge
content = content.replace(
  `    <div class="flex items-center gap-2">
      <span id="badge-agendamentos" class="hidden bg-red-500 text-white text-xs rounded-full px-2 py-0.5"></span>
      <svg class="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
      </svg>
    </div>
  </button>

  <!-- BOTÃO MEUS AGENDAMENTOS -->
  <button id="btn-agendamentos" onclick="abrirModalAgendamentos()" class="w-full bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between hover:bg-gray-50">
    <div class="flex items-center gap-3">
      <span class="text-xl">🗓️</span>
      <div>
        <p class="text-sm font-semibold text-gray-900">Meus Agendamentos</p>
        <p class="text-xs text-gray-500">Ver corridas agendadas</p>
      </div>
    </div>
    <svg class="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
    </svg>
  </button>`,
  `    <svg class="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
    </svg>
  </button>

  <!-- BOTÃO MEUS AGENDAMENTOS -->
  <button id="btn-agendamentos" onclick="abrirModalAgendamentos()" class="w-full bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between hover:bg-gray-50">
    <div class="flex items-center gap-3">
      <span class="text-xl">🗓️</span>
      <div>
        <p class="text-sm font-semibold text-gray-900">Meus Agendamentos</p>
        <p class="text-xs text-gray-500">Ver corridas agendadas</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <span id="badge-agendamentos" class="hidden bg-red-500 text-white text-xs rounded-full px-2 py-0.5"></span>
      <svg class="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
      </svg>
    </div>
  </button>`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('File fixed!');
