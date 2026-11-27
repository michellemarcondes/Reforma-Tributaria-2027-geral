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
  assert(txt.includes('20 EFD lida(s): 10 ICMS/IPI · 10 Contribuições') && txt.includes('janeiro/2026 a outubro/2026') && txt.includes('inventário (Bloco H) de 31/12/2025'), 'EFD reconhecidas: 10 ICMS/IPI + 10 Contribuições, jan–out/2026, Bloco H de 31/12/2025');
  assert(await page.isVisible('#e-proj-card') && (await page.inputValue('#e-ini')) === 'bloco-h' && (await page.inputValue('#e-base')) === '2', 'cartão de projeção: partida pelo Bloco H e média de 2 meses (setembro e outubro)');
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('Isto é uma projeção') && txt.includes('R$ 49.120,00') && txt.includes('R$ 4.543,60'), 'inventário de abertura projetado R$ 49.120,00 e crédito R$ 4.543,60');
  assert(txt.includes('novembro/2026 deve terminar com R$ 47.026,67') && txt.includes('dezembro/2026 começa com R$ 47.026,67, recebe R$ 11.680,00, baixa R$ 9.586,67 e termina com R$ 49.120,00'), 'narrativa: novembro termina com 47.026,67; dezembro = novembro + entradas − saídas = 49.120,00');
  assert(txt.includes('R$ 11.680,00 de entradas') && txt.includes('R$ 9.586,67 de saídas a custo'), 'médias dos meses-base: entradas 11.680,00 e saídas a custo 9.586,67');
  const linhas = await page.$$eval('#e-proj-tab tbody tr', t => t.map(x => x.textContent.replace(/ /g, ' ')));
  assert(linhas.filter(l => /EFD/.test(l)).length === 10 && linhas.filter(l => /projeção/.test(l)).length === 2 && /outubro\/2026.*R\$ 44\.933,33$/.test(linhas[9]), 'tabela mês a mês: 10 meses reais (EFD) + 2 projetados; outubro fecha em R$ 44.933,33');
  assert(txt.includes('R$ 999,00') && txt.includes('Itens em revisão'), 'fornecedor do Simples (CRT pelo XML) em revisão: crédito potencial R$ 999,00 não somado');
  assert(txt.includes('R$ 23.500,00') && txt.includes('R$ 378,63'), 'estoque sem crédito projetado R$ 23.500,00; parcela mensal R$ 378,63');
  await page.screenshot({ path: SHOTS + '/estoque-projecao.png', fullPage: true });
  // ponto de partida informado
  await page.selectOption('#e-ini', 'informado');
  assert(await page.isVisible('#e-estinf'), 'campo de estoque informado aparece');
  await page.fill('#e-estinf', '50.000'); await page.focus('#e-margem');
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('R$ 54.186,67') && txt.includes('R$ 5.012,27'), 'partida informada (R$ 50.000 em 31/10): projetado R$ 54.186,67 e crédito R$ 5.012,27');
  await page.selectOption('#e-base', '1');
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('meses-base (outubro/2026)'), 'média de 1 mês-base (outubro/2026)');
  await page.selectOption('#e-ini', 'bloco-h'); await page.selectOption('#e-base', '2');
  // mes de apropriacao
  await page.selectOption('#e-mes', '6');
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('junho/2027') && txt.includes('maio/2028'), 'apropriação em junho/2027: parcelas até maio/2028');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#e-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert(csv.includes('2026-12;projecao') && csv.includes('credito_projetado;4543,60'), 'CSV com a projeção mês a mês e o crédito');
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
