import { latLngToCell } from 'h3-js' 
 
 // Calcula split em duas faixas usando valor_minimo da tarifa como limite 
 export function calcularSplitFaixas(valorFinal, tarifaAtiva, temLider = false) { 
   const valorLimite = tarifaAtiva ? parseFloat(tarifaAtiva.valor_minimo || 0) : 0 
 
   // Percentuais 
   const p1motor = 0.82 
   const p1plat = 0.18 
   const p2motor = 0.50 
   const p2plat = 0.50 
 
   let faixa1, faixa2 = null 
   let motorista, plataforma 
 
   if (valorLimite > 0 && valorFinal > valorLimite) { 
     const excedente = parseFloat((valorFinal - valorLimite).toFixed(2)) 
 
     faixa1 = { 
       valor: valorLimite, 
       motorista: parseFloat((valorLimite * p1motor).toFixed(2)), 
       plataforma: parseFloat((valorLimite * p1plat).toFixed(2)) 
     } 
     faixa2 = { 
       valor: excedente, 
       motorista: parseFloat((excedente * p2motor).toFixed(2)), 
       plataforma: parseFloat((excedente * p2plat).toFixed(2)) 
     } 
     motorista = parseFloat((faixa1.motorista + faixa2.motorista).toFixed(2)) 
     plataforma = parseFloat((faixa1.plataforma + faixa2.plataforma).toFixed(2)) 
   } else { 
     faixa1 = { 
       valor: valorFinal, 
       motorista: parseFloat((valorFinal * p1motor).toFixed(2)), 
       plataforma: parseFloat((valorFinal * p1plat).toFixed(2)) 
     } 
     motorista = faixa1.motorista 
     plataforma = faixa1.plataforma 
   } 
 
   return { 
     valor_total: valorFinal, 
     valor_limite: valorLimite, 
     faixa1, 
     faixa2, 
     motorista_total: motorista, 
     plataforma_total: plataforma, 
     teve_excedente: faixa2 !== null 
   } 
 } 
 
 // Gera H3 ID da origem da corrida 
 export function getH3Id(lat, lng, resolucao = 8) { 
   try { 
     return latLngToCell(lat, lng, resolucao) 
   } catch(e) { 
     return null 
   } 
 }
