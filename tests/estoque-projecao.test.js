// Teste da projecao do estoque de abertura com EFD (tests/gerar-efd-estoque.js). Valores esperados calculados a mao.
// Uso: node tests/estoque-projecao.test.js <pasta>
const fs = require('fs'), path = require('path'), E = require('../assets/js/estoque.js');
const DIR = process.argv[2];
const ok = (c, m) => { if (!c) { console.error('FALHOU: ' + m); process.exit(1); } console.log('ok -', m); };
const perto = (a, b) => Math.abs(a - b) < 0.02;
const movs = fs.readdirSync(DIR).filter(f => f.endsWith('.txt')).map(f => E.lerEfdMov(fs.readFileSync(path.join(DIR, f), 'latin1')));
const xml = E.lerXml(fs.readFileSync(path.join(DIR, 'nf-simples-out.xml'), 'utf8'), 'x');
const crtPorCnpj = { [xml.emit.cnpj]: xml.emit.crt };
ok(movs.length === 20 && movs.filter(m => m.inventario).length === 1, '20 EFD lidas (10 ICMS/IPI + 10 Contribuições), 1 inventário (Bloco H)');
// padrao: pseudo-inventario calculado pelas entradas e saidas (sem Bloco H)
const p = E.projetarEstoque(movs, { regime: 'LP', crtPorCnpj });
ok(p.inicio === 'calculado' && p.mesInicio === '2026-01' && E.GRUPOS.every(g => p.saldoInicial[g] === 0), 'padrão: pseudo-inventário calculado a partir de zero em jan/2026 (o Bloco H não é usado)');
const out = p.linhas.find(l => l.mes === '2026-10'), nov = p.linhas.find(l => l.mes === '2026-11'), dez = p.linhas.find(l => l.mes === '2026-12');
ok(out.tipo === 'real' && nov.tipo === 'projecao' && dez.tipo === 'projecao' && p.linhas.length === 12, 'jan–out reais (EFD) e nov–dez projetados pela média');
const cm = 9680 / 5, sai = 900 * 2 + 4 * cm, liq = 11680 - sai;
ok(perto(out.grupos.elegivel.ent, 11680) && perto(out.grupos.elegivel.sai, sai), 'mês real: entradas a custo 11.680 e saídas a custo médio das entradas do período = ' + sai.toFixed(2));
ok(perto(out.grupos.elegivel.fim, 10 * liq) && perto(out.grupos.elegivel.fim, 21360), 'pseudo-inventário elegível em 31/10/2026 = 10 × (entradas − saídas) = 21.360,00');
ok(perto(p.final.elegivel, 25632) && perto(nov.grupos.elegivel.ini, out.grupos.elegivel.fim) && perto(nov.grupos.elegivel.fim, 23496), 'inventário de abertura projetado (31/12/2026) = 25.632,00; novembro parte de outubro e termina em 23.496,00');
ok(perto(p.credito, 2370.96), 'crédito presumido = 9,25% × 25.632,00 = 2.370,96');
ok(perto(p.final.revisar, 10800) && perto(p.potencialRevisar, 999), 'caixas do fornecedor do Simples (CRT 1 pelo XML) em revisão: estoque 10.800, crédito potencial 999,00');
ok(perto(p.final.nao, 12000), 'estoque sem crédito projetado (uniformes comprados em 2026) = 12.000; o arroz do Bloco H não entra');
ok(p.mesesBase.join() === '2026-09,2026-10', 'média de 2 meses-base (set e out/2026)');
const p1 = E.projetarEstoque(movs, { regime: 'LP', crtPorCnpj, mesesBase: 1 });
ok(p1.mesesBase.length === 2, 'mesesBase = 1 é elevado para o mínimo de 2 meses');
const p3 = E.projetarEstoque(movs, { regime: 'LP', crtPorCnpj, mesesBase: 3 });
ok(p3.mesesBase.join() === '2026-08,2026-09,2026-10' && perto(p3.final.elegivel, 25632), 'média de 3 meses-base (ago–out/2026)');
const pe = E.projetarEstoque(movs, { regime: 'LP', crtPorCnpj, estoqueInicial: 5000 });
ok(perto(pe.saldoInicial.elegivel, 5000) && perto(pe.final.elegivel, 30632) && perto(pe.credito, 2833.46), 'estoque inicial informado de 5.000: projetado 30.632,00 e crédito 2.833,46');
const umMes = movs.filter(m => m.mes === '2026-10');
ok(/pelo menos 2 meses/.test(E.projetarEstoque(umMes, { regime: 'LP' }).erro || ''), 'só 1 mês de EFD: erro pedindo no mínimo 2 meses');
// partida opcional pelo Bloco H
const ph = E.projetarEstoque(movs, { regime: 'LP', crtPorCnpj, inicio: 'bloco-h' });
ok(ph.inicio === 'bloco-h' && ph.inventario.data === '31122025' && perto(ph.saldoInicial.elegivel, 24000) && perto(ph.saldoInicial.nao, 11500), 'opcional: Bloco H de 31/12/2025 (elegível 24.000; sem crédito 11.500)');
const cmH = (20000 + 10 * 9680) / (10 + 50), liqH = 11680 - (900 * 2 + 4 * cmH);
ok(perto(ph.final.elegivel, 24000 + 12 * liqH) && perto(ph.final.elegivel, 49120) && perto(ph.credito, 4543.6) && perto(ph.final.nao, 23500), 'opcional Bloco H: projetado 49.120,00, crédito 4.543,60, sem crédito 23.500');
const px = E.projetarEstoque(movs, { regime: 'LP', crtPorCnpj, inicio: 'xml', estoqueXml: { elegivel: 30000 } });
ok(px.inicio === 'xml' && px.mesInicio === '2026-11' && perto(px.final.elegivel, 30000 + 2 * liq), 'partida pelo estoque dos XMLs (31/10): 30.000 + 2 meses de média = ' + (30000 + 2 * liq).toFixed(2));
const pi = E.projetarEstoque(movs, { regime: 'LP', crtPorCnpj, inicio: 'informado', estoqueInformado: 50000 });
ok(perto(pi.final.elegivel, 54272) && perto(pi.credito, 5020.16), 'partida por valor informado (50.000 em 31/10): 54.272,00 e crédito 5.020,16');
// sem a EFD de agosto: o mes e preenchido pela media e ha aviso
const semAgo = movs.filter(m => m.mes !== '2026-08');
const pa = E.projetarEstoque(semAgo, { regime: 'LP', crtPorCnpj });
ok(pa.linhas.find(l => l.mes === '2026-08').tipo === 'media' && pa.avisos.some(a => /08\/2026/.test(a)), 'mês sem EFD (ago/2026) preenchido pela média, com aviso');
// sem EFD Contribuicoes: sem saidas -> aviso
const so = movs.filter(m => m.tipo === 'icms');
const ps = E.projetarEstoque(so, { regime: 'LP' });
ok(ps.avisos.some(a => /Sem saídas identificadas/.test(a)), 'sem saídas por item (só EFD ICMS): aviso de estoque superestimado');
console.log('\nTESTES DA PROJEÇÃO DO ESTOQUE PASSARAM');
