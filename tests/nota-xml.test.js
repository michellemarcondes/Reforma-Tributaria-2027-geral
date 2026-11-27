// Testes do simulador de nota a partir do XML (tests/gerar-nfe-2026.js). Valores esperados calculados à mão.
// Uso: node tests/nota-xml.test.js <pasta_xmls>
const fs = require('fs'), path = require('path');
const N = require('../assets/js/nota-xml.js'), RTC = require('../assets/js/engine.js');
const idx = RTC.criarIndice(require('../data/rtc.json'));
const DIR = process.argv[2];
const ok = (c, m) => { if (!c) { console.error('FALHOU: ' + m); process.exit(1); } console.log('ok -', m); };
const eq = (a, b) => Math.abs(a - b) < 0.005;
const r2 = v => Math.round(v * 100) / 100;
const nota = N.ler(fs.readFileSync(path.join(DIR, 'nfe-lucro-presumido.xml'), 'utf8'));
ok(nota.itens.length === 3 && nota.emit.uf === 'SP' && nota.vNF === 1920 && nota.temIbsCbs2026, 'XML lido: 3 itens, SP, vNF 1.920,00, com CBS/IBS de teste de 2026');
ok(N.detectarRegime(nota) === 'LP', 'regime sugerido pelo XML: Lucro Presumido (PIS 0,65%)');
const r = N.calcular(nota, { idx });
const [a, b, c] = r.itens;
// item 1 — notebook: 1.000 − ICMS 180 − PIS 0,65%×820 − Cofins 3%×820
ok(eq(a.icms, 180) && eq(a.pis, 5.33) && eq(a.cofins, 24.6) && eq(a.liquido, 790.07), 'notebook: valor líquido = 1.000 − 180 − 5,33 − 24,60 = 790,07');
const cbs1 = r2(790.07 * 0.113), ibs1 = r2(790.07 * 0.0005) * 2;
ok(eq(a.cbs, cbs1) && eq(a.cbsIbs, r2(cbs1 + ibs1)), 'notebook: CBS 11,3% = ' + cbs1 + ' e IBS 0,1% = ' + ibs1.toFixed(2) + ' por fora');
const icmsA1 = r2(0.18 * (790.07 + cbs1 + ibs1) / 0.82), icmsB1 = r2(0.18 * 790.07 / 0.82);
ok(eq(a.com.icms, icmsA1) && eq(a.com.icms, 193.2) && eq(a.com.total, 1073.35), 'notebook, CBS/IBS na base do ICMS: ICMS = 18% × (790,07 + 90,08) / 82% = 193,20; total 1.073,35');
ok(eq(a.sem.icms, icmsB1) && eq(a.sem.icms, 173.43) && eq(a.sem.total, 1053.58), 'notebook, CBS/IBS fora da base: ICMS = 18% × 790,07 / 82% = 173,43; total 1.053,58');
ok(eq(a.ipi, 100) && eq(a.com.ipi, 0), 'IPI de 100,00 retirado; IPI zero em 2027');
// item 2 — arroz: cesta básica (CBS/IBS zero), ICMS com redução de base, PIS/Cofins alíquota zero
ok(a.cls.c === '000001' && b.cls.c === '200003' && c.cls.c === '200030', 'classificação automática pelo NCM: notebook integral, arroz 200003 (zero), medicamento 200030 (redução 60%)');
ok(eq(b.pis + b.cofins, 0) && eq(b.liquido, 465) && eq(b.cbsIbs, 0) && eq(b.com.icms, 35) && eq(b.com.total, 500), 'arroz: líquido 465,00; CBS/IBS zero; ICMS efetivo 7% volta a 35,00; total 500,00');
// item 3 — medicamento: 300 + 10 frete − 20 desconto = 290; ICMS 52,20; PIS/Cofins monofásico (CST 04); ST 30 mantido
ok(eq(c.vo, 290) && eq(c.liquido, 237.8) && eq(c.st, 30), 'medicamento: líquido = 290 − 52,20 = 237,80 (PIS/Cofins monofásico na revenda); ST 30,00 mantido');
ok(eq(c.cbs, 10.75) && eq(c.cbsIbs, 10.85), 'medicamento: CBS 4,52% (redução 60%) = 10,75; CBS + IBS = 10,85');
ok(eq(c.com.icms, 54.58) && eq(c.com.total, 333.23) && eq(c.sem.icms, 52.2) && eq(c.sem.total, 330.85), 'medicamento: ICMS 54,58 (com) / 52,20 (sem); total 333,23 / 330,85');
ok(eq(r.hoje.cobrado, 1920) && eq(r.hoje.liquido, 1492.87) && eq(r.c.com.total, 1906.58) && eq(r.c.sem.total, 1884.43), 'nota: cobrado hoje 1.920,00; líquido 1.492,87; 2027 = 1.906,58 (com) / 1.884,43 (sem)');
ok(r.atual === r.c.com && N.calcular(nota, { idx, cbsIbsNaBaseIcms: false }).atual.total === r.c.sem.total, 'cenário padrão: CBS/IBS na base do ICMS; desmarcado: fora da base');
ok(r.avisos.some(x => /teste de 2026/.test(x)) && !r.avisos.some(x => /difere/.test(x)), 'aviso da CBS/IBS de teste de 2026; soma dos itens confere com o vNF');
const lr = N.calcular(nota, { idx, regime: 'LR' });
ok(eq(lr.itens[0].pis, 13.53) && eq(lr.itens[0].cofins, 62.32) && eq(lr.itens[0].liquido, 744.15) && lr.avisos.some(x => /PIS destacado/.test(x)), 'Lucro Real: PIS 1,65% e Cofins 7,6% sobre 820 → líquido 744,15, com aviso de divergência do XML');
const comIcms = N.calcular(nota, { idx, excluirIcmsPis: false });
ok(eq(comIcms.itens[0].pis, 6.5) && eq(comIcms.itens[0].cofins, 30), 'sem o Tema 69: PIS/Cofins sobre 1.000 (6,50 + 30,00)');
const zfm = N.calcular(nota, { idx, manterIpi: true });
ok(eq(zfm.itens[0].com.ipi, r2(983.27 * 0.1)), 'IPI mantido (ZFM): 10% sobre o novo valor do produto = 98,33');
const sn = N.ler(fs.readFileSync(path.join(DIR, 'nfe-simples.xml'), 'utf8'));
const rs = N.calcular(sn, { idx });
ok(rs.regime === 'SN' && eq(rs.itens[0].liquido, 1000) && rs.avisos.some(x => /Simples Nacional/.test(x)), 'emitente do Simples: regime sugerido SN, sem tributos destacados, aviso sobre o DAS');
ok(N.ler('<xml>qualquer</xml>').erro, 'arquivo que não é NF-e: erro');
console.log('\nTESTES DO SIMULADOR DE NOTA PELO XML PASSARAM');
