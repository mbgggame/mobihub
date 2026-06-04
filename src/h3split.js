import { query } from './db.js' 
import { latLngToCell } from 'h3-js' 
 
export function getH3Id(lat, lng, resolution = 8) { 
  try { 
    return latLngToCell(parseFloat(lat), parseFloat(lng), resolution) 
  } catch(e) { 
    return null 
  } 
} 
 
export async function calcularSplitFaixas(valorTotal, tarifaAtiva, temLider = false) { 
  // Busca regras do banco 
  const splitRules = (await query( 
    'SELECT * FROM split_rules WHERE ativo = 1 AND com_lider = $1 ORDER BY id DESC LIMIT 1', 
    [temLider] 
  )).rows[0] 
 
  const pctMotorista = parseFloat(splitRules?.percentual_motorista || (temLider ? 82 : 80)) / 100 
  const pctPlataforma = parseFloat(splitRules?.percentual_plataforma || (temLider ? 15 : 20)) / 100 
  const pctLider = parseFloat(splitRules?.percentual_lider || (temLider ? 3 : 0)) / 100 
 
  const valorMinimo = parseFloat(tarifaAtiva?.valor_minimo || 0) 
  const valor = parseFloat(valorTotal) 
 
  // Faixa 1 — até o valor mínimo 
  const f1 = Math.min(valor, valorMinimo) 
  const f1_motorista = parseFloat((f1 * pctMotorista).toFixed(2)) 
  const f1_plataforma = parseFloat((f1 * pctPlataforma).toFixed(2)) 
  const f1_lider = parseFloat((f1 * pctLider).toFixed(2)) 
 
  // Faixa 2 — excedente 
  const f2 = Math.max(0, valor - valorMinimo) 
  const f2_motorista = parseFloat((f2 * 0.50).toFixed(2)) 
  const f2_plataforma = parseFloat((f2 * (temLider ? 0.47 : 0.50)).toFixed(2)) 
  const f2_lider = parseFloat((f2 * (temLider ? 0.03 : 0)).toFixed(2)) 
 
  const motorista_total = parseFloat((f1_motorista + f2_motorista).toFixed(2)) 
  const plataforma_total = parseFloat((f1_plataforma + f2_plataforma).toFixed(2)) 
  const lider_total = parseFloat((f1_lider + f2_lider).toFixed(2)) 
 
  return { 
    motorista_total, 
    plataforma_total, 
    lider_total, 
    faixa1: { valor: f1, motorista: f1_motorista, plataforma: f1_plataforma, lider: f1_lider }, 
    faixa2: { valor: f2, motorista: f2_motorista, plataforma: f2_plataforma, lider: f2_lider }, 
    percentuais: { motorista: pctMotorista * 100, plataforma: pctPlataforma * 100, lider: pctLider * 100 } 
  } 
}
