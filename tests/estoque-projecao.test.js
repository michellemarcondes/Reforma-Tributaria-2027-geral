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
const p = E.projetarEstoque(movs, { regime: 'LP', crtPorCnpj, mesesBase: 2 });
ok(p.inicio === 'bloco-h' && p.inventario.data === '31122025' && p.mesInicio === '2026-01', 'ponto de partida: Bloco H de 31/12/2025, reconstituído a partir de jan/2026');
ok(perto(p.saldoInicial.elegivel, 24000) && perto(p.saldoInicial.nao, 11500) && perto(p.saldoInicial.revisar, 0), 'inventário por grupo: elegível 24.000 (sabonete + notebook); sem crédito 11.500 (arroz CST 06 + uniforme uso e consumo); item de terceiros ignorado');
const out = p.linhas.find(l => l.mes === '2026-10'), nov = p.linhas.find(l => l.mes === '2026-11'), dez = p.linhas.find(l => l.mes === '2026-12');
ok(out.tipo === 'real' && nov.tipo === 'projecao' && dez.tipo === 'projecao' && p.linhas.length === 12, 'jan–out reais (EFD) e nov–dez projetados pela média');
const cmNote = (20000 + 10 * 9680) / (10 + 50), sai = 900 * 2 + 4 * cmNote, liq = 11680 - sai;
ok(perto(out.grupos.elegivel.ent, 11680) && perto(out.grupos.elegivel.sai, sai), 'mês real: entradas a custo 11.680 (notebook sem ICMS) e saídas a custo médio ' + sai.toFixed(2));
ok(perto(out.grupos.elegivel.fim, 24000 + 10 * liq), 'estoque elegível em 31/10/2026 = ' + (24000 + 10 * liq).toFixed(2));
ok(perto(p.final.elegivel, 24000 + 12 * liq) && perto(nov.grupos.elegivel.ini, out.grupos.elegivel.fim), 'inventário de abertura projetado (31/12/2026) = ' + (24000 + 12 * liq).toFixed(2) + '; novembro parte do saldo de outubro');
ok(perto(p.credito, Math.round((24000 + 12 * liq) * 0.0925 * 100) / 100), 'crédito presumido = 9,25% × estoque elegível projetado = ' + ((24000 + 12 * liq) * 0.0925).toFixed(2));
ok(perto(p.final.revisar, 10800) && perto(p.potencialRevisar, 999), 'caixas do fornecedor do Simples (CRT 1 pelo XML) em revisão: estoque 10.800, crédito potencial 999,00');
ok(perto(p.final.nao, 23500), 'estoque sem crédito projetado: arroz + uniformes = 23.500');
const px = E.projetarEstoque(movs, { regime: 'LP', crtPorCnpj, inicio: 'xml', estoqueXml: { elegivel: 30000 } });
ok(px.inicio === 'xml' && px.mesInicio === '2026-11' && perto(px.final.elegivel, 30000 + 2 * liq), 'partida pelo estoque dos XMLs (31/10): 30.000 + 2 meses de média = ' + (30000 + 2 * liq).toFixed(2));
const pi = E.projetarEstoque(movs, { regime: 'LP', crtPorCnpj, inicio: 'informado', estoqueInformado: 50000, mesesBase: 1 });
ok(perto(pi.final.elegivel, 50000 + 2 * liq) && pi.mesesBase.length === 1 && pi.mesesBase[0] === '2026-10', 'partida por valor informado, média de 1 mês-base (out/2026)');
// sem a EFD de agosto: o mes e preenchido pela media e ha aviso
const semAgo = movs.filter(m => m.mes !== '2026-08');
const pa = E.projetarEstoque(semAgo, { regime: 'LP', crtPorCnpj });
ok(pa.linhas.find(l => l.mes === '2026-08').tipo === 'media' && pa.avisos.some(a => /08\/2026/.test(a)), 'mês sem EFD (ago/2026) preenchido pela média, com aviso');
// sem EFD Contribuicoes: sem saidas -> aviso
const so = movs.filter(m => m.tipo === 'icms');
const ps = E.projetarEstoque(so, { regime: 'LP' });
ok(ps.avisos.some(a => /Sem saídas identificadas/.test(a)), 'sem saídas por item (só EFD ICMS): aviso de estoque superestimado');
console.log('\nTESTES DA PROJEÇÃO DO ESTOQUE PASSARAM');
