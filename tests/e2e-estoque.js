// Teste no navegador da aba "Crédito de estoque".
// Uso: node tests/e2e-estoque.js <url> <pasta_xmls> <pasta_zip> <pasta_screenshots>
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const [BASE, DIR, ZDIR, SHOTS] = process.argv.slice(2);
const nt = s => String(s).replace(/ /g, ' ');
const assert = (c, m) => { if (!c) throw new Error('FALHOU: ' + m); console.log('ok -', m); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const erros = []; page.on('pageerror', e => erros.push(String(e))); page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
  await page.goto(BASE + '#credito-estoque');
  await page.waitForSelector('#v-estoque:not([hidden])');
  assert(true, 'aba "Crédito de estoque" abre pelo link #credito-estoque');
  const arquivos = fs.readdirSync(DIR).map(f => path.join(DIR, f)).concat([path.join(ZDIR, 'notas.zip')]);
  await page.setInputFiles('#e-files', arquivos);
  await page.waitForSelector('#e-res:not([hidden]) .ct');
  let txt = nt(await page.textContent('#e-res'));
  assert(nt(await page.textContent('#e-lidos')).includes('17') , '17 arquivos lidos (14 XMLs + 3 dentro do ZIP)');
  assert(nt(await page.inputValue('#e-cnpj')) === '11.222.333/0001-81' && (await page.inputValue('#e-nome')) === 'Comercial Exemplo Ltda', 'empresa e CNPJ detectados dos XMLs');
  assert(txt.includes('R$ 3.009,14'), 'crédito total R$ 3.009,14 (ZIP com notas repetidas não duplica)');
  assert(txt.includes('R$ 250,76') && txt.includes('janeiro/2027') && txt.includes('dezembro/2027'), 'cronograma: 12 parcelas de R$ 250,76, janeiro a dezembro/2027');
  assert(txt.includes('R$ 83,25') && txt.includes('Itens em revisão'), 'aviso do crédito potencial em revisão (R$ 83,25)');
  assert(txt.includes('R$ 2.350,00'), 'bens importados: PIS/Cofins-Importação R$ 2.350,00');
  await page.screenshot({ path: SHOTS + '/estoque-1.png', fullPage: true });

  await page.selectOption('#e-mes', '3');
  txt = nt(await page.textContent('#e-res'));
  assert(txt.includes('março/2027') && txt.includes('fevereiro/2028'), 'mês de apropriação março: parcelas de março/2027 a fevereiro/2028');

  // editar quantidade em estoque do parafuso (fornecedor Alfa)
  const linhaP100 = page.locator('#e-tab tbody tr', { hasText: 'Distribuidora Alfa' }).filter({ hasText: 'P100' });
  await linhaP100.locator('input[data-q]').fill('750');
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('R$ 2.882,51'), 'qtd em estoque 750 de 1.500: crédito cai para R$ 2.882,51');
  // somar item em revisao (Simples)
  await page.locator('#e-tab tbody tr', { hasText: 'Caixa de papelao' }).locator('input[data-inc]').check();
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('R$ 2.965,76'), 'marcar item do Simples soma R$ 83,25 (total R$ 2.965,76)');
  // filtros e busca
  await page.click('#e-res .fb[data-f="nao"]');
  const nNao = await page.locator('#e-tab tbody tr').count();
  assert(nNao === 4, 'filtro "Sem crédito": 4 produtos (arroz, imobilizado, transferência e devolução)');
  await page.click('#e-res .fb[data-f="todos"]');
  await page.fill('#e-busca', 'shampoo');
  assert(await page.locator('#e-tab tbody tr').count() === 1, 'busca por descrição filtra a tabela');
  await page.fill('#e-busca', '');

  // % geral
  await page.fill('#e-pct', '50'); await page.click('#e-pct-ap');
  txt = nt(await page.textContent('#e-sum'));
  // metade de tudo: nacional 7126/2 *9.25% e importado 2350/2 + Simples (marcado) 900/2*9,25%
  assert(txt.includes('Aplicado') || nt(await page.textContent('#e-msg')).includes('50'), 'percentual geral aplicado');
  // inventario CSV
  await page.setInputFiles('#e-inv', { name: 'inv.csv', mimeType: 'text/csv', buffer: Buffer.from('codigo;descricao;quantidade\nP100;Parafuso;1500\nC10;Shampoo;200\nL1;Sabao;120\n') });
  await page.waitForFunction(() => document.querySelector('#e-msg').textContent.includes('Inventário importado'));
  txt = nt(await page.textContent('#e-sum'));
  // P100: 1.500 un distribuidas da compra mais recente (nf012: 500) para a mais antiga... mesma chave agregada -> qEstoque 1500 = tudo (253,26); C10 319,12; L1 48,84; demais zerados
  assert(txt.includes('R$ 621,22'), 'inventário importado: P100 + C10 + L1 = R$ 621,22 (itens fora do inventário zerados)');
  // CSV
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#e-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert(csv.includes('credito_total;621,22') && csv.includes('parcela 12;'), 'exportação da memória de cálculo em CSV');
  // Lucro Real
  await page.click('#e-limpar');
  assert(await page.isHidden('#e-res'), 'limpar notas');
  await page.selectOption('#e-regime', 'LR');
  await page.setInputFiles('#e-files', arquivos);
  await page.waitForSelector('#e-res:not([hidden]) .ct');
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('R$ 319,12') && txt.includes('Lucro Real'), 'Lucro Real: só monofásico/ST (R$ 319,12)');
  await page.selectOption('#e-regime', 'LP');
  // outros estoques sem XML
  await page.fill('#e-outros', '10.000'); await page.focus('#e-aliq');
  txt = nt(await page.textContent('#e-sum'));
  assert(txt.includes('R$ 3.934,14'), 'outros estoques sem XML (R$ 10.000,00) somam R$ 925,00');
  await page.screenshot({ path: SHOTS + '/estoque-2.png', fullPage: true });

  // celular
  const m = await browser.newContext({ ...devices['iPhone 13'] });
  const mp = await m.newPage(); mp.on('pageerror', e => erros.push(String(e)));
  await mp.goto(BASE + '#credito-estoque'); await mp.waitForSelector('#v-estoque:not([hidden])');
  await mp.setInputFiles('#e-files', arquivos); await mp.waitForSelector('#e-res:not([hidden]) .ct');
  assert(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem horizontal da página');
  await mp.screenshot({ path: SHOTS + '/estoque-celular.png', fullPage: false });
  assert(erros.length === 0, 'console sem erros de JS ' + (erros.length ? JSON.stringify(erros) : ''));
  await browser.close();
  console.log('\nTESTES DA ABA CRÉDITO DE ESTOQUE PASSARAM');
})().catch(e => { console.error(e.message || e); process.exit(1); });
