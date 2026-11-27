// Teste no navegador da projecao do estoque de abertura (EFD de tests/gerar-efd-estoque.js).
// Uso: node tests/e2e-estoque-projecao.js <url> <pasta_efd> <pasta_screenshots>
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const [BASE, DIR, SHOTS] = process.argv.slice(2);
const nt = s => String(s).replace(/ /g, ' ').replace(/\s+/g, ' ');
const assert = (c, m) => { if (!c) throw new Error('FALHOU: ' + m); console.log('ok -', m); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const erros = []; page.on('pageerror', e => erros.push(String(e))); page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
  await page.goto(BASE + '#credito-estoque'); await page.waitForSelector('#v-estoque:not([hidden])');
  const arqs = fs.readdirSync(DIR).map(f => path.join(DIR, f));
  await page.setInputFiles('#e-files', arqs);
  await page.waitForSelector('#e-res:not([hidden]) .ct');
  let txt = nt(await page.textContent('#e-lidos'));
  assert(txt.includes('20 EFD lida(s): 10 ICMS/IPI · 10 Contribuições') && txt.includes('janeiro/2026 a outubro/2026') && txt.includes('pseudo-inventário calculado pelas entradas e saídas'), 'EFD reconhecidas: 10 ICMS/IPI + 10 Contribuições, jan–out/2026, pseudo-inventário');
  assert(await page.isVisible('#e-proj-card') && (await page.inputValue('#e-ini')) === 'calculado' && (await page.inputValue('#e-base')) === '2', 'cartão de projeção: padrão pseudo-inventário calculado e média de 2 meses (setembro e outubro)');
  const bases = await page.$$eval('#e-base option', o => o.map(x => x.value));
  assert(bases.join() === '2,3,6,10', 'meses-base: 2, 3, 6 ou todos os 10 (sem opção de 1 mês)');
  assert(await page.isVisible('#e-estini') && !(await page.isVisible('#e-estinf')), 'campo opcional de estoque inicial visível; estoque informado oculto');
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('Isto é uma projeção') && txt.includes('pseudo-inventário calculado pelas entradas e saídas a custo das EFD de janeiro/2026 a outubro/2026') && txt.includes('a partir de zero'), 'narrativa: pseudo-inventário de jan a out/2026 a partir de zero');
  assert(txt.includes('R$ 25.632,00') && txt.includes('R$ 2.370,96'), 'inventário de abertura projetado R$ 25.632,00 e crédito R$ 2.370,96');
  assert(txt.includes('novembro/2026 deve terminar com R$ 23.496,00') && txt.includes('dezembro/2026 começa com R$ 23.496,00, recebe R$ 11.680,00, baixa R$ 9.544,00 e termina com R$ 25.632,00'), 'narrativa: novembro termina com 23.496,00; dezembro = 25.632,00');
  assert(txt.includes('R$ 11.680,00 de entradas') && txt.includes('R$ 9.544,00 de saídas a custo'), 'médias dos meses-base: entradas 11.680,00 e saídas a custo 9.544,00');
  const linhas = await page.$$eval('#e-proj-tab tbody tr', t => t.map(x => x.textContent.replace(/ /g, ' ')));
  assert(linhas.filter(l => /EFD/.test(l)).length === 10 && linhas.filter(l => /projeção/.test(l)).length === 2 && /janeiro\/2026.*R\$\s0,00.*R\$\s2\.136,00$/.test(linhas[0]) && /outubro\/2026.*R\$\s21\.360,00$/.test(linhas[9]), 'tabela: janeiro parte de 0 e fecha 2.136,00; outubro fecha em R$ 21.360,00; 2 meses projetados');
  assert(txt.includes('R$ 999,00') && txt.includes('Itens em revisão'), 'fornecedor do Simples (CRT pelo XML) em revisão: crédito potencial R$ 999,00 não somado');
  assert(txt.includes('R$ 12.000,00') && txt.includes('R$ 197,58'), 'estoque sem crédito projetado R$ 12.000,00; parcela mensal R$ 197,58');
  await page.screenshot({ path: SHOTS + '/estoque-projecao.png', fullPage: true });
  // estoque inicial opcional
  await page.fill('#e-estini', '5.000'); await page.focus('#e-margem');
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('estoque inicial informado de R$ 5.000,00') && txt.includes('R$ 30.632,00') && txt.includes('R$ 2.833,46'), 'estoque inicial de R$ 5.000: projetado R$ 30.632,00 e crédito R$ 2.833,46');
  await page.fill('#e-estini', ''); await page.focus('#e-margem');
  await page.selectOption('#e-base', '3');
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('meses-base (agosto/2026, setembro/2026 e outubro/2026)') && txt.includes('R$ 25.632,00'), 'média de 3 meses-base (ago, set e out/2026)');
  await page.selectOption('#e-base', '2');
  // ponto de partida informado
  await page.selectOption('#e-ini', 'informado');
  assert(await page.isVisible('#e-estinf') && !(await page.isVisible('#e-estini')), 'campo de estoque informado aparece; estoque inicial some');
  await page.fill('#e-estinf', '50.000'); await page.focus('#e-margem');
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('R$ 54.272,00') && txt.includes('R$ 5.020,16'), 'partida informada (R$ 50.000 em 31/10): projetado R$ 54.272,00 e crédito R$ 5.020,16');
  // Bloco H opcional
  await page.selectOption('#e-ini', 'bloco-h');
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('R$ 49.120,00') && txt.includes('R$ 4.543,60'), 'opcional Bloco H: projetado R$ 49.120,00 e crédito R$ 4.543,60');
  await page.selectOption('#e-ini', 'calculado');
  // mes de apropriacao
  await page.selectOption('#e-mes', '6');
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('junho/2027') && txt.includes('maio/2028'), 'apropriação em junho/2027: parcelas até maio/2028');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#e-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert(csv.includes('2026-01;real;0,00;11680,00;9544,00;2136,00') && csv.includes('2026-12;projecao') && csv.includes('credito_projetado;2370,96'), 'CSV com o pseudo-inventário mês a mês e o crédito');
  // so 1 mes de EFD: exige no minimo 2
  const p1 = await ctx.newPage(); p1.on('pageerror', e => erros.push(String(e)));
  await p1.goto(BASE + '#credito-estoque'); await p1.waitForSelector('#v-estoque:not([hidden])');
  await p1.setInputFiles('#e-files', arqs.filter(f => /202610\.txt$/.test(f)));
  await p1.waitForSelector('#e-sum .box.alert');
  assert(nt(await p1.textContent('#e-sum')).includes('Envie pelo menos 2 meses de EFD') && nt(await p1.textContent('#e-lidos')).includes('envie no mínimo 2 meses'), 'só 1 mês de EFD: aviso pedindo no mínimo 2 meses');
  // celular
  const m = await browser.newContext({ ...devices['iPhone 13'] });
  const mp = await m.newPage(); mp.on('pageerror', e => erros.push(String(e)));
  await mp.goto(BASE + '#credito-estoque'); await mp.waitForSelector('#v-estoque:not([hidden])');
  await mp.setInputFiles('#e-files', arqs); await mp.waitForSelector('#e-res:not([hidden]) .ct');
  assert(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem horizontal da página');
  assert(erros.length === 0, 'console sem erros de JS ' + (erros.length ? JSON.stringify(erros) : ''));
  await browser.close();
  console.log('\nTESTES DA PROJEÇÃO DO ESTOQUE (NAVEGADOR) PASSARAM');
})().catch(e => { console.error(e.message || e); process.exit(1); });
