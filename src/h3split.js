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
 
  const pctMotorista = parseFloat(splitRules?.percentual_motorista || 80) / 100 
  const pctPlataforma = parseFloat(splitRules?.percentual_plataforma || 20) / 100 
  const pctLider = parseFloat(splitRules?.percentual_lider || 0) / 100 
 
  const valor = parseFloat(valorTotal) 
 
  // Split flat — sem faixas 
  const motorista_total = parseFloat((valor * pctMotorista).toFixed(2)) 
  const lider_total = parseFloat((valor * pctLider).toFixed(2)) 
  const plataforma_total = parseFloat((valor - motorista_total - lider_total).toFixed(2)) 
 
  return { 
    motorista_total, 
    plataforma_total, 
    lider_total, 
    percentuais: { 
      motorista: pctMotorista * 100, 
      plataforma: pctPlataforma * 100, 
      lider: pctLider * 100 
    }, 
    // H3 apenas registra para histórico — sem impacto no cálculo 
    h3_id: null, 
    faixa1: { valor: valor, motorista: motorista_total, plataforma: plataforma_total, lider: lider_total }, 
    faixa2: { valor: 0, motorista: 0, plataforma: 0, lider: 0 } 
  } 
}
