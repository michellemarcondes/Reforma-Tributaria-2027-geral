// Teste no navegador do simulador de nota a partir do XML (tests/gerar-nfe-2026.js).
// Uso: node tests/e2e-nota-xml.js <url> <pasta_xmls> <pasta_screenshots>
const { chromium, devices } = require('playwright');
const path = require('path');
const [BASE, DIR, SHOTS] = process.argv.slice(2);
const nt = s => String(s).replace(/ /g, ' ').replace(/\s+/g, ' ');
const assert = (c, m) => { if (!c) throw new Error('FALHOU: ' + m); console.log('ok -', m); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const erros = []; page.on('pageerror', e => erros.push(String(e))); page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
  await page.goto(BASE + '#nota'); await page.waitForSelector('#v-nota:not([hidden])');
  assert(await page.isVisible('#nx-drop') && await page.isHidden('#nx-opc'), 'cartão do XML visível; opções aparecem só depois do envio');
  await page.setInputFiles('#nx-file', path.join(DIR, 'nfe-lucro-presumido.xml'));
  await page.waitForSelector('#nx-res:not([hidden]) #nx-comp');
  assert((await page.inputValue('#nx-regime')) === 'LP' && (await page.inputValue('#nx-pis')) === '0,65' && (await page.inputValue('#nx-cofins')) === '3', 'regime e alíquotas sugeridos pelo XML: Lucro Presumido, 0,65% e 3%');
  assert(await page.isChecked('#nx-base') && nt(await page.textContent('#nx-uf')) === 'SP', 'padrão: CBS/IBS compõem a base do ICMS; estado SP');
  let txt = nt(await page.textContent('#nx-res'));
  assert(txt.includes('R$ 1.920,00') && txt.includes('R$ 1.492,87'), 'total cobrado hoje R$ 1.920,00 e valor líquido R$ 1.492,87');
  assert(txt.includes('R$ 1.906,58') && txt.includes('R$ 1.884,43'), 'total 2027: R$ 1.906,58 (CBS/IBS na base do ICMS) e R$ 1.884,43 (fora da base) — os dois cenários');
  const itens = await page.$$eval('#nx-itens tbody tr', t => t.map(x => x.textContent.replace(/ /g, ' ')));
  assert(/NOTEBOOK.*000001.*integral.*R\$ 790,07.*R\$ 193,20.*R\$ 1\.073,35/.test(itens[0]), 'item 1 (notebook): líquido 790,07; ICMS 2027 193,20; total 1.073,35');
  assert(/ARROZ.*200003.*alíquota zero.*R\$ 465,00/.test(itens[1]) && /MEDICAMENTO.*200030.*redução 60%.*R\$ 237,80.*R\$ 10,85/.test(itens[2]), 'arroz com alíquota zero; medicamento com redução de 60% (CBS + IBS 10,85)');
  assert(txt.includes('teste de 2026'), 'aviso: CBS/IBS de teste de 2026 desconsiderados');
  await page.screenshot({ path: SHOTS + '/nota-xml.png', fullPage: true });
  await page.uncheck('#nx-base');
  txt = nt(await page.textContent('#nx-res'));
  assert(txt.includes('CBS/IBS fora da base do ICMS') && /Total da nota em 2027 — CBS\/IBS fora da base do ICMS/.test(nt(await page.textContent('#nx-res .counts'))) && nt(await page.textContent('#nx-res .counts')).includes('R$ 1.884,43'), 'desmarcado: destaque passa para o cenário sem CBS/IBS na base (R$ 1.884,43)');
  await page.check('#nx-base');
  await page.selectOption('#nx-regime', 'LR');
  assert((await page.inputValue('#nx-pis')) === '1,65' && nt(await page.textContent('#nx-itens')).includes('R$ 744,15'), 'Lucro Real: PIS 1,65% e Cofins 7,6% → notebook com líquido R$ 744,15');
  await page.selectOption('#nx-regime', 'LP');
  await page.fill('#nx-pis', '1');
  assert((await page.inputValue('#nx-regime')) === 'INF', 'alterar a alíquota muda o regime para "alíquotas informadas"');
  await page.selectOption('#nx-regime', 'LP');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#nx-csv')]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  assert(csv.includes('790,07') && csv.includes('1073,35') && csv.includes('1053,58'), 'CSV item a item com os dois cenários');
  // Simples Nacional
  await page.setInputFiles('#nx-file', path.join(DIR, 'nfe-simples.xml'));
  await page.waitForFunction(() => /CONFECCOES/.test(document.querySelector('#nx-res').textContent));
  assert((await page.inputValue('#nx-regime')) === 'SN' && nt(await page.textContent('#nx-res')).includes('Emitente do Simples Nacional'), 'nota do Simples: regime SN sugerido e aviso sobre o DAS');
  // calculo manual continua funcionando
  assert(await page.isVisible('#f-nota'), 'simulação manual continua disponível abaixo');
  // celular
  const m = await browser.newContext({ ...devices['iPhone 13'] });
  const mp = await m.newPage(); mp.on('pageerror', e => erros.push(String(e)));
  await mp.goto(BASE + '#nota'); await mp.waitForSelector('#v-nota:not([hidden])');
  await mp.setInputFiles('#nx-file', path.join(DIR, 'nfe-lucro-presumido.xml')); await mp.waitForSelector('#nx-res:not([hidden]) #nx-comp');
  assert(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem horizontal da página');
  await mp.screenshot({ path: SHOTS + '/nota-xml-celular.png', fullPage: true });
  assert(erros.length === 0, 'console sem erros de JS ' + (erros.length ? JSON.stringify(erros) : ''));
  await browser.close();
  console.log('\nTESTES DO SIMULADOR DE NOTA PELO XML (NAVEGADOR) PASSARAM');
})().catch(e => { console.error(e.message || e); process.exit(1); });
