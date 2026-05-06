// ── FUNÇÕES DE CÁLCULO ──────────────────────────── 
 
export function calculateInitialWaitCost(waitTimeInMinutes, config = {}) { 
  const minutosGratis = parseFloat(config.espera_minutos_gratis || 5) 
  const valorMinuto = parseFloat(config.espera_valor_minuto || 0.60) 
 
  if (waitTimeInMinutes <= minutosGratis) return 0 
 
  const minutosExtras = waitTimeInMinutes - minutosGratis 
  return parseFloat((minutosExtras * valorMinuto).toFixed(2)) 
} 
 
export function calculateStopCost(stopTimeInMinutes, config = {}) { 
  const minutosGratis = parseFloat(config.parada_minutos_gratis || 2) 
  const valorMinuto = parseFloat(config.parada_valor_minuto || 0.60) 
 
  if (stopTimeInMinutes <= minutosGratis) return 0 
 
  const minutosExtras = stopTimeInMinutes - minutosGratis 
  return parseFloat((minutosExtras * valorMinuto).toFixed(2)) 
} 
 
export function calculateTotalRideCost(baseFare, initialWaitCost = 0, stopsCost = 0, config = {}) { 
  const valorMinimo = parseFloat(config.valor_minimo_corrida || 7.00) 
  const total = baseFare + initialWaitCost + stopsCost 
  return parseFloat(Math.max(total, valorMinimo).toFixed(2)) 
} 
 
export function calcularTempoMinutos(inicio, fim = new Date()) { 
  const ms = new Date(fim) - new Date(inicio) 
  return parseFloat((ms / 1000 / 60).toFixed(2)) 
} 
 
export function podeMotoristaCancel(motoristChegouAt, config = {}) { 
  const maxMinutos = parseFloat(config.espera_max_cancelamento || 10) 
  const tempoEspera = calcularTempoMinutos(motoristChegouAt) 
  return tempoEspera >= maxMinutos 
} 
 
// ── EXEMPLOS DE CÁLCULO ────────────────────────── 
// 
// Corrida base R$ 15,00 
// Espera inicial: 8 min → 3 min extras × R$ 0,60 = R$ 1,80 
// 1 parada de 5 min → 3 min extras × R$ 0,60 = R$ 1,80 
// Total: R$ 15,00 + R$ 1,80 + R$ 1,80 = R$ 18,60 
// 
// Cancelamento por espera: 
// Motorista esperou 12 min → taxa R$ 7,00 
