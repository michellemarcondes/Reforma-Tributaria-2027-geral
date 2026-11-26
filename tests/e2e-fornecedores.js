// Teste no navegador da aba "Fornecedores" (respostas da BrasilAPI simuladas para casos determinísticos).
// Uso: node tests/e2e-fornecedores.js <url> <planilha_skill.xlsx> <pasta_xmls> <pasta_screenshots>
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const [BASE, XLSX, XDIR, SHOTS] = process.argv.slice(2);
const nt = s => String(s).replace(/ /g, ' ');
const assert = (c, m) => { if (!c) throw new Error('FALHOU: ' + m); console.log('ok -', m); };
const CAD = {
  '00000000000191': { razao_social: 'BANCO DO BRASIL SA', descricao_situacao_cadastral: 'ATIVA', opcao_pelo_simples: false, data_opcao_pelo_simples: '2007-07-01', data_exclusao_do_simples: '2007-07-01', opcao_pelo_mei: false },
  '11111111000191': { razao_social: 'HIBRIDO COMERCIO LTDA', descricao_situacao_cadastral: 'ATIVA', opcao_pelo_simples: true, data_opcao_pelo_simples: '2020-01-01', data_exclusao_do_simples: null, opcao_pelo_mei: false },
  '22222222000191': { razao_social: 'SEM OPCAO ME', descricao_situacao_cadastral: 'ATIVA', opcao_pelo_simples: true, data_opcao_pelo_simples: '2019-01-01', opcao_pelo_mei: true },
  '33333333000191': { razao_social: 'CANCELOU EPP', descricao_situacao_cadastral: 'BAIXADA', opcao_pelo_simples: null, opcao_pelo_mei: null }
};
async function mock(ctx) {
  await ctx.route('https://brasilapi.com.br/**', async route => {
    const c = route.request().url().split('/').pop();
    if (CAD[c]) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(CAD[c]) });
    return route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"CNPJ não encontrado"}' });
  });
  await ctx.route('https://minhareceita.org/**', route => route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  await ctx.route('https://consopt.www8.receita.fazenda.gov.br/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Consulta Optantes</title>' }));
}
const contagem = async page => (await page.$$eval('#f-sum .ct .n', e => e.map(x => x.textContent))).join('/');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mock(ctx);
  const page = await ctx.newPage();
  const erros = []; page.on('pageerror', e => erros.push(String(e)));
  await page.goto(BASE + '#fornecedores');
  await page.waitForSelector('#v-fornec:not([hidden])');
  await page.evaluate(() => { try { Object.keys(localStorage).filter(k => /fornecedores/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e) {} });
  await page.reload(); await page.waitForSelector('#v-fornec:not([hidden])');
  assert(true, 'aba "Fornecedores" abre pelo link #fornecedores');

  await page.fill('#f-txt', 'Fornecedor;CNPJ;Valor\nBanco do Brasil;00.000.000/0001-91;100.000,00\nHibrido Comercio;11.111.111/0001-91;50.000\nSem Opcao ME;22222222000191;20.000,00\nCancelou EPP;33333333000191;10.000\nInexistente;44444444000191;5.000\nErrado;12345678000100');
  await page.click('#f-add');
  const msg = nt(await page.textContent('#f-msg'));
  assert(msg.includes('5 fornecedor(es) adicionado(s)') && msg.includes('CNPJ inválido'), 'lista colada: 5 válidos adicionados e 1 CNPJ inválido avisado');
  await page.click('#f-consultar');
  await page.waitForFunction(() => /consultados em/.test(document.querySelector('#f-prog-txt').textContent), null, { timeout: 60000 });
  assert(await contagem(page) === '2/1/1/1', 'consulta automática: 2 integral (fora do Simples), 1 limitado (MEI), 1 pendente (Simples), 1 verificar (inexistente)');
  let txt = nt(await page.textContent('#f-res'));
  assert(txt.includes('BAIXADA') && txt.includes('CNPJ não encontrado'), 'alertas: CNPJ baixado e CNPJ inexistente');
  assert(txt.includes('R$ 110.000,00') && txt.includes('59,5% das compras'), 'valores e % das compras por tipo de crédito (R$ 110.000,00 · 59,5%)');

  // opcao de 2027 do optante do Simples
  const linhaS = page.locator('#f-tab tbody tr[data-c="11111111000191"]');
  const [popup] = await Promise.all([page.waitForEvent('popup'), linhaS.locator('[data-rf]').click()]);
  assert(popup.url().startsWith('https://consopt.www8.receita.fazenda.gov.br/consultaoptantes'), 'botão abre o Consulta Optantes da Receita em nova aba');
  assert((await page.evaluate(() => navigator.clipboard.readText())) === '11111111000191', 'CNPJ copiado para a área de transferência');
  await popup.close();
  await linhaS.locator('select[data-op]').selectOption('optou');
  assert(await contagem(page) === '3/1/0/1', 'registrar "Optou pelo regime regular" → crédito integral (3 integral, 0 pendente)');
  await linhaS.locator('select[data-op]').selectOption('naoOptou');
  assert(await contagem(page) === '2/2/0/1', 'registrar "Não optou" → crédito limitado ao DAS');
  await page.screenshot({ path: SHOTS + '/fornec-1.png', fullPage: true });

  // importar planilha da skill
  await page.setInputFiles('#f-file', XLSX);
  await page.waitForFunction(() => /Planilha da consulta de regime importada/.test(document.querySelector('#f-msg').textContent));
  assert(nt(await page.textContent('#f-msg')).includes('5 CNPJ(s), 1 novo(s)'), 'planilha .xlsx da skill importada (5 CNPJs, 1 novo)');
  assert(await linhaS.locator('select[data-op]').inputValue() === 'optou', 'opção de 2027 do híbrido preenchida pela planilha');
  // filtros
  await page.click('#f-res .fb[data-f="lim"]');
  const lim = await page.locator('#f-tab tbody tr').count();
  assert(lim === 2, 'filtro "Crédito limitado": o MEI e o Simples com opção cancelada');
  await page.click('#f-res .fb[data-f="todos"]');
  // exportar
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#f-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert(csv.split('\n').filter(Boolean).length === 7 && csv.includes('credito_cbs_ibs_2027'), 'exportação CSV com os 6 fornecedores');
  // persistencia
  await page.reload(); await page.waitForSelector('#v-fornec:not([hidden])');
  assert(await page.locator('#f-tab tbody tr').count() === 6, 'lista e classificação persistem após recarregar');

  // fornecedores a partir das notas (aba Credito de estoque)
  await page.click('#t-estoque');
  await page.setInputFiles('#e-files', fs.readdirSync(XDIR).map(f => path.join(XDIR, f)));
  await page.waitForSelector('#e-res:not([hidden]) .ct');
  await page.click('#t-fornec');
  await page.click('#f-notas');
  assert(/fornecedor\(es\) encontrados nas notas/.test(nt(await page.textContent('#f-msg'))), 'fornecedores extraídos das notas de compra da aba Crédito de estoque');

  // celular
  const m = await browser.newContext({ ...devices['iPhone 13'] }); await mock(m);
  const mp = await m.newPage(); mp.on('pageerror', e => erros.push(String(e)));
  await mp.goto(BASE + '#fornecedores'); await mp.waitForSelector('#v-fornec:not([hidden])');
  assert(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem horizontal da página');
  assert(erros.length === 0, 'console sem erros de JS ' + (erros.length ? JSON.stringify(erros) : ''));
  await browser.close();
  console.log('\nTESTES DA ABA FORNECEDORES PASSARAM');
})().catch(e => { console.error(e.message || e); process.exit(1); });
