// Teste do motor da aba "Melhor regime" com os SPED de tests/gerar-sped-teste.js.
// Os valores esperados sao calculados aqui de forma independente (aritmetica direta).
// Uso: node tests/regime.test.js <pasta_sped>
const fs = require('fs'), path = require('path');
const R = require('../assets/js/engine.js'); globalThis.RTC = R;
const G = require('../assets/js/regime.js');
const DIR = process.argv[2];
const ok = (c, m) => { if (!c) { console.error('FALHOU: ' + m); process.exit(1); } console.log('ok -', m); };
const perto = (a, b, tol) => Math.abs(a - b) <= (tol || 0.05);
const idx = R.criarIndice(require('../data/rtc.json'));
const lidos = fs.readdirSync(DIR).filter(f => f.endsWith('.txt')).map(f => {
  const t = fs.readFileSync(path.join(DIR, f), 'latin1'), tipo = G.detectar(t);
  const o = tipo === 'icms' ? G.lerEfdIcms(t) : tipo === 'contrib' ? G.lerEfdContrib(t) : G.lerEcd(t); o.arquivo = f; return o;
});
ok(lidos.filter(x => x.tipo === 'icms').length === 12 && lidos.filter(x => x.tipo === 'contrib').length === 12 && lidos.filter(x => x.tipo === 'ecd').length === 1, 'tipos detectados: 12 EFD ICMS/IPI, 12 EFD Contribuições, 1 ECD');
const c = G.consolidar(lidos);
ok(c.meses.length === 12 && c.cnpj === '11222333000181', '12 meses e CNPJ da empresa');
ok(perto(c.receitaMerc, 1210000) && perto(c.exportacao, 10000), 'receita de mercadorias (C190 vendas + exportação, nota cancelada ignorada) = 1.210.000');
ok(perto(c.receitaServ, 120000) && perto(c.iss, 6000), 'serviços (A170) = 120.000 e ISS = 6.000');
ok(perto(c.devolucoes, 12000) && perto(c.icms, 144000) && perto(c.compras, 528000), 'devoluções 12.000; ICMS a recolher (E110) 144.000; base de crédito das compras (sem ICMS) 528.000');
ok(perto(c.pis2026 + c.cofins2026, 12 * (80000 * 0.0065 + 80000 * 0.03)), 'PIS/Cofins 2026 (M200/M600) lidos');
ok(perto(c.ncmVendas['10063021'], 360000) && perto(c.ncmVendas['84713012'], 600000) && perto(c.servicosLst['17.19'], 120000), 'vendas por NCM (EFD Contribuições) e serviços por item da LC 116');
const pB2B = c.b2b / (c.b2b + c.b2c);
ok(perto(pB2B, 1080000 / 1320000, 0.0001), 'vendas a PJ (B2B) = 81,8%');
ok(c.dre && perto(c.dre.receitaMerc, 1210000) && perto(c.dre.cmv, 660000) && perto(c.dre.folha, 180000) && perto(c.dre.proLabore, 36000) && perto(c.dre.despCred, 84000) && perto(c.dre.despSemCred, 14400) && perto(c.dre.despFin, 6000) && perto(c.dre.deprec, 12000) && perto(c.dre.outrasRec, 8000) && perto(c.dre.devol, 12000), 'DRE da ECD (I355) classificada: CMV, folha, pró-labore, despesas com/sem crédito, financeiras, depreciação');
const b = G.composicaoBeneficios(idx, c.ncmVendas, c.servicosLst, c.exportacao);
ok(perto(b.valores.zero, 360000) && perto(b.valores.red60, 240000) && perto(b.valores.integral, 600000) && perto(b.valores.red30, 120000) && perto(b.valores.naoInc, 10000), 'benefícios: arroz alíquota zero, sabonete −60%, notebook integral, contabilidade −30%, exportação');

const e = { receitaMerc: c.receitaMerc, receitaServ: c.receitaServ, outrasRec: c.dre.outrasRec, devol: c.devolucoes, cmv: c.dre.cmv, folha: c.dre.folha, proLabore: c.dre.proLabore,
  despCred: c.dre.despCred, despSemCred: c.dre.despSemCred, despFin: c.dre.despFin, deprec: c.dre.deprec, icms: c.icms, iss: c.iss, comprasCredito: c.compras,
  composicao: b.pct, receitaTrimestres: G.trimestres(c), atividadeMerc: 'comercio', atividadeServ: 'servicos', encargos: 27.8, anexoMerc: 'I', anexoServ: 'III', regimeAtual: 'LP', pctB2B: pB2B };
const r = G.calcular(e);
// --- esperado (independente)
const base = 1330000 - 12000 - 144000 - 6000;                          // 1.168.000
const deb = base / 1330000 * (600000 * 0.114 + 240000 * 0.114 * 0.4 + 120000 * 0.114 * 0.7);
const cred = 528000 * 0.114, cbs = deb - cred;
ok(perto(r.cbsIbs.debito, deb, 0.02) && perto(r.cbsIbs.credito, cred, 0.02) && perto(r.cbsIbs.liquido, cbs, 0.02), 'CBS/IBS: débito ' + deb.toFixed(2) + ' − crédito ' + cred.toFixed(2) + ' = ' + cbs.toFixed(2));
const fd = 1 - 12000 / 1330000, cpp = 180000 * 0.278 + 36000 * 0.2;
const bI = (1210000 * 0.08 + 120000 * 0.32) * fd + 8000, bC = (1210000 * 0.12 + 120000 * 0.32) * fd + 8000;
ok(perto(r.lp.irpj, bI * 0.15, 0.5) && perto(r.lp.csll, bC * 0.09, 0.5), 'Presumido: IRPJ ' + (bI * 0.15).toFixed(2) + ' e CSLL ' + (bC * 0.09).toFixed(2) + ' (presunção 8/12% e 32%, sem adicional)');
const lpTot = cbs + bI * 0.15 + bC * 0.09 + cpp + 144000 + 6000;
ok(perto(r.lp.total, lpTot, 1), 'Presumido: total ' + lpTot.toFixed(2));
const lucro = 1168000 + 8000 - (660000 + 84000 + 14400 + 6000 + 180000 + 36000 + 12000 + cpp);
const lrTot = cbs + lucro * 0.24 + cpp + 150000;
ok(perto(r.lr.lucroContabil, lucro, 0.5) && perto(r.lr.total, lrTot, 1), 'Real: lucro ' + lucro.toFixed(2) + ', total ' + lrTot.toFixed(2));
const efI = (1330000 * 0.107 - 22500) / 1330000, efIII = (1330000 * 0.16 - 35640) / 1330000;
const das = 1210000 * fd * efI + 120000 * fd * efIII;
ok(r.sn.elegivel && perto(r.sn.das, das, 1), 'Simples: DAS ' + das.toFixed(2) + ' (Anexo I 4ª faixa ' + (efI * 100).toFixed(4) + '%, Anexo III ' + (efIII * 100).toFixed(4) + '%)');
ok(r.ranking.map(x => x.id).join(',') === 'SNH,SN,LR,LP', 'ranking: Simples híbrido < Simples < Real < Presumido');
ok(perto(r.sn.hibrido.total, r.sn.das - r.sn.cbsIbsNoDas + cbs, 1) && r.avisos.some(a => /híbrido sai mais barato/.test(a)), 'híbrido = DAS sem CBS/IBS + CBS/IBS do regime regular (aproveita benefícios e créditos)');
ok(r.avisos.some(a => /pessoas jurídicas/.test(a)), 'alerta B2B: 82% das vendas para PJ com Simples padrão');
ok(perto(r.economia, lpTot - r.melhor.total, 1), 'economia em relação ao regime atual (Presumido) = ' + (lpTot - r.melhor.total).toFixed(2));
// LC 224/2025: receita alta
const r2 = G.calcular(Object.assign({}, e, { receitaMerc: 12000000, receitaServ: 0, devol: 0, outrasRec: 0, receitaTrimestres: null }));
const q = 3000000, ex = (q - 1250000) / q, bq = q * 0.08 * (1 + 0.1 * ex);
ok(perto(r2.lp.irpj, 4 * (bq * 0.15 + (bq - 60000) * 0.10), 1) && !r2.sn.elegivel, 'LC 224/2025: R$ 12 mi/ano → presunção 8,8% sobre o que excede R$ 1,25 mi no trimestre; Simples inelegível');
// balancete CSV como alternativa a ECD
const csv = fs.readFileSync(path.join(DIR, 'balancete-12m.csv'), 'utf8').replace(/^﻿/, '').trim().split('\n').map(l => l.split(';'));
const bal = G.lerBalancete(csv);
ok(perto(bal.dre.cmv, 660000) && perto(bal.dre.receitaMerc, 1210000) && perto(bal.dre.folha, 180000) && perto(bal.dre.despCred, 84000), 'balancete CSV: contas sintéticas e patrimoniais ignoradas, DRE igual à da ECD');
console.log('\nTESTES DO MOTOR DE REGIME PASSARAM');
