// Teste ponta a ponta no navegador (Playwright/Chromium): as 3 funcionalidades + premissas.
// Uso: node tests/e2e.js [http://localhost:8765/] [pasta_screenshots]
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8765/';
const SHOTS = process.argv[3] || '/tmp';
const nt = s => String(s).replace(/\u00a0/g, ' ');
const assert = (c, m) => { if (!c) throw new Error('FALHOU: ' + m); console.log('ok -', m); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const erros = [];
  page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', e => erros.push(String(e)));
  await page.goto(BASE);
  await page.waitForSelector('#v-sim:not([hidden])');
  assert(!(await page.$('img')), 'versão geral: sem imagens de logotipo');
  assert((nt(await page.textContent('#meta-base'))).includes('V0073'), 'versão da base oficial exibida');

  // ---------- 1. Simulador - Lucro Presumido
  await page.fill('#s-nome', 'Comercial Exemplo Ltda.');
  await page.selectOption('#s-regime', 'LP');
  await page.fill('#s-f-integral', '100.000,00');
  await page.fill('#s-d-integral', '2.000,00');
  await page.fill('#s-icms', '18.000,00');
  await page.fill('#s-cr', '50.000,00');
  await page.click('#f-sim button[type=submit]');
  await page.waitForSelector('#s-res:not([hidden])');
  let txt = nt(await page.textContent('#s-res'));
  // base = 100000-2000-18000 = 80000; debito CBS 9040,00 IBS 80,00; credito CBS 5650,00 IBS 50,00 -> CBS 3390, IBS 30
  assert(txt.includes('R$ 3.390,00'), 'LP: CBS a recolher = R$ 3.390,00');
  assert(txt.includes('R$ 30,00'), 'LP: IBS a recolher = R$ 30,00');
  assert(txt.includes('R$ 3.420,00'), 'LP: total = R$ 3.420,00');
  assert(txt.includes('R$ 80.000,00'), 'LP: base (receita líquida) = R$ 80.000,00');
  assert(txt.includes('Comparativo com 2026'), 'LP: comparativo PIS/Cofins exibido');
  await page.screenshot({ path: SHOTS + '/1-simulador-lp.png', fullPage: true });

  // formatos de numero: "100.000", "2.000", "18.000" (ponto de milhar sem virgula) e "50000"
  await page.fill('#s-f-integral', '100.000'); await page.fill('#s-d-integral', '2.000'); await page.fill('#s-icms', '18.000'); await page.fill('#s-cr', '50000');
  await page.click('#f-sim button[type=submit]');
  txt = nt(await page.textContent('#s-res'));
  assert(txt.includes('R$ 80.000,00') && txt.includes('R$ 3.390,00'), 'números "100.000", "2.000", "18.000" e "50000" lidos corretamente (base R$ 80.000,00)');
  assert(nt(await page.inputValue('#s-d-integral')) === '2.000,00', 'campo reformatado ao sair: "2.000" -> "2.000,00"');
  for (const [entrada, esperado] of [['1.234.567,89', '1.234.567,89'], ['1234567.89', '1.234.567,89'], ['1,234,567.89', '1.234.567,89'], ['2000', '2.000,00'], ['2000,5', '2.000,50'], ['R$ 750', '750,00']]) {
    await page.fill('#s-f-integral', entrada); await page.focus('#s-d-integral');
    assert(nt(await page.inputValue('#s-f-integral')) === esperado, 'formato "' + entrada + '" interpretado como ' + esperado);
  }
  await page.fill('#s-f-integral', '100.000,00'); await page.fill('#s-d-integral', '2.000,00'); await page.fill('#s-icms', '18.000,00'); await page.fill('#s-cr', '50.000,00');

  // faixas: 50 mil integral + 50 mil com redução de 60% (deduções rateadas pro rata)
  await page.fill('#s-f-integral', '50.000'); await page.fill('#s-f-red60', '50.000');
  await page.fill('#s-d-integral', '1.000'); await page.fill('#s-d-red60', '1.000');
  await page.focus('#s-icms');
  assert(nt(await page.textContent('#s-bruto-total')) === 'R$ 100.000,00', 'faixas: faturamento bruto somado automaticamente (R$ 100.000,00)');
  await page.click('#f-sim button[type=submit]');
  txt = nt(await page.textContent('#s-res'));
  // base 40.000 + 40.000 -> debitos CBS 4.520 + 1.808 ; creditos 5.650 -> CBS 678 / IBS 6
  assert(txt.includes('R$ 678,00') && txt.includes('R$ 6,00'), 'faixas 50% integral + 50% redução 60%: CBS R$ 678,00 e IBS R$ 6,00');
  assert(txt.includes('Cálculo por faixa de tributação') && txt.includes('4,52%'), 'quadro por faixa exibido com alíquota efetiva 4,52%');

  // cenario misto: 60 mil integral, 20 mil red60, 5 mil red80, 10 mil aliquota zero, 5 mil isento
  await page.fill('#s-f-integral', '60.000'); await page.fill('#s-f-red60', '20.000'); await page.fill('#s-f-red80', '5.000');
  await page.fill('#s-f-zero', '10.000'); await page.fill('#s-f-naoInc', '5.000');
  await page.fill('#s-d-integral', '600'); await page.fill('#s-d-red60', '200'); await page.fill('#s-d-red80', '50'); await page.fill('#s-d-zero', '100'); await page.fill('#s-d-naoInc', '50');
  await page.fill('#s-icms', '9.000'); await page.fill('#s-cr', '40.000');
  await page.click('#f-sim button[type=submit]');
  txt = nt(await page.textContent('#s-res'));
  assert(txt.includes('R$ 6.102,00') && txt.includes('R$ 813,60') && txt.includes('R$ 101,70'), 'misto: CBS por faixa 6.102,00 / 813,60 / 101,70');
  assert(txt.includes('R$ 2.497,30') && txt.includes('R$ 22,10') && txt.includes('R$ 2.519,40'), 'misto: CBS R$ 2.497,30 + IBS R$ 22,10 = R$ 2.519,40');
  await page.screenshot({ path: SHOTS + '/1b-simulador-faixas.png', fullPage: true });
  for (const k of ['red60', 'red80', 'zero', 'naoInc']) { await page.fill('#s-f-' + k, ''); await page.fill('#s-d-' + k, ''); }
  await page.fill('#s-f-integral', '100.000,00'); await page.fill('#s-d-integral', '2.000,00'); await page.fill('#s-icms', '18.000,00'); await page.fill('#s-cr', '50.000,00');

  // devolucao na faixa correta: 50 mil integral + 50 mil red60, devolucao de 5 mil so na faixa red60
  await page.fill('#s-f-integral', '50.000'); await page.fill('#s-f-red60', '50.000'); await page.fill('#s-d-integral', ''); await page.fill('#s-d-red60', '5.000');
  await page.fill('#s-icms', ''); await page.fill('#s-cr', '');
  await page.click('#f-sim button[type=submit]');
  txt = nt(await page.textContent('#s-res'));
  // integral: 50.000 x 11,3% = 5.650 ; red60: 45.000 x 4,52% = 2.034 -> CBS 7.684,00 ; IBS 50 + 18 = 68
  assert(txt.includes('R$ 7.684,00') && txt.includes('R$ 68,00') && nt(await page.textContent('#s-devol-total')) === 'R$ 5.000,00', 'devolução abatida só na faixa red60: CBS R$ 7.684,00 (não rateada)');
  // preenchimento pela EFD (12 meses de EFD ICMS/IPI + Contribuicoes)
  if (process.env.SPED_DIR) {
    const sped = require('fs').readdirSync(process.env.SPED_DIR).filter(f => /^efd-/.test(f)).map(f => require('path').join(process.env.SPED_DIR, f));
    await page.setInputFiles('#s-efd', sped);
    await page.waitForFunction(() => /Preenchido com a média mensal/.test(document.querySelector('#s-efd-res').textContent));
    const val = async id => nt(await page.inputValue(id));
    assert(await val('#s-f-integral') === '50.000,00' && await val('#s-f-zero') === '30.000,00' && await val('#s-f-red60') === '20.000,00' && await val('#s-f-red30') === '10.000,00' && await val('#s-f-naoInc') === '833,33',
      'EFD → faixas (média de 12 meses): notebook integral 50 mil, arroz alíquota zero 30 mil, sabonete −60% 20 mil, contabilidade −30% 10 mil, exportação 833,33');
    assert(await val('#s-d-red60') === '1.000,00' && await val('#s-d-integral') === '' && await val('#s-icms') === '12.000,00' && await val('#s-iss') === '500,00' && await val('#s-cr') === '44.000,00',
      'EFD → devolução do sabonete na faixa −60% (C170), ICMS (E110), ISS (A100) e compras sem ICMS');
    assert((await page.inputValue('#s-regime')) === 'LP' && /12 mês/.test(nt(await page.textContent('#s-efd-res'))), 'regime detectado (PIS/Cofins cumulativo → Presumido) e período informado');
    for (const k of ['zero', 'red60', 'red30', 'naoInc', 'integral']) { await page.fill('#s-f-' + k, ''); await page.fill('#s-d-' + k, ''); }
    await page.fill('#s-cr', ''); await page.fill('#s-iss', '');
  }
  await page.fill('#s-f-integral', '100.000,00'); await page.fill('#s-d-integral', '2.000,00'); await page.fill('#s-icms', '18.000,00'); await page.fill('#s-cr', '50.000,00'); await page.fill('#s-f-red60', ''); await page.fill('#s-d-red60', '');

  // Simples Nacional padrão
  await page.selectOption('#s-regime', 'SN');
  assert(await page.isHidden('#s-icms'), 'SN: campo ICMS oculto');
  await page.selectOption('#s-anexo', 'I');
  await page.fill('#s-rbt12', '150.000,00');
  await page.fill('#s-f-integral', '12.500,00'); await page.fill('#s-d-integral', '');
  assert(await page.isVisible('#s-sn-nota'), 'SN: aviso de que reduções não alteram o DAS');
  await page.click('#f-sim button[type=submit]');
  txt = nt(await page.textContent('#s-res'));
  // Anexo I faixa 1: efetiva 4%; DAS = 500,00; CBS = 12500*0.6132% = 76,65 ; IBS = 12500*0.0068% = 0,85
  assert(txt.includes('R$ 500,00'), 'SN: DAS total = R$ 500,00');
  assert(txt.includes('R$ 76,65') && txt.includes('R$ 0,85'), 'SN: CBS R$ 76,65 e IBS R$ 0,85 no DAS');
  await page.screenshot({ path: SHOTS + '/2-simulador-sn.png', fullPage: true });

  // validação de entrada inválida
  await page.fill('#s-f-integral', 'abc');
  await page.click('#f-sim button[type=submit]');
  assert((nt(await page.textContent('#s-msg'))).includes('inválido'), 'mensagem de valor inválido');
  await page.fill('#s-f-integral', '12.500,00');

  // ---------- 2. Painel do contador
  await page.click('#t-painel');
  await page.click('#p-clear').catch(() => {});
  await page.click('#p-exemplo');
  await page.waitForSelector('#p-tab tbody tr');
  assert((await page.$$('#p-tab tbody tr')).length === 4, 'painel: 4 clientes de exemplo');
  const tot1 = nt(await page.textContent('#p-tab tfoot'));
  assert(/Total \(4 calculados\)/.test(tot1), 'painel: totais calculados para 4 clientes');
  // editar faturamento do primeiro cliente e conferir recálculo
  await page.fill('#p-tab tbody tr:nth-child(1) input[data-k=fat]', '100.000,00');
  await page.fill('#p-tab tbody tr:nth-child(1) input[data-k=ded]', '20.000,00');
  await page.fill('#p-tab tbody tr:nth-child(1) input[data-k=compras]', '50.000,00');
  const r1 = await page.$$eval('#p-tab tbody tr:nth-child(1) td.res', t => t.map(x => x.textContent.replace(/\u00a0/g, ' ')));
  assert(r1[0] === 'R$ 3.390,00' && r1[1] === 'R$ 30,00', 'painel: recálculo da linha (CBS R$ 3.390,00 / IBS R$ 30,00)');
  // importar CSV
  const csv = 'nome;regime;faturamento;deducoes;compras;anexo;rbt12\nCliente CSV A;LR;200000,00;36000,00;100000,00;;\nCliente CSV B;Simples;30000,00;0;;III;360000,00\n';
  await page.setInputFiles('#p-file', { name: 'clientes.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.waitForFunction(() => document.querySelectorAll('#p-tab tbody tr').length === 6);
  assert((nt(await page.textContent('#p-msg'))).includes('2 cliente(s) importado(s)'), 'painel: importação de CSV (2 clientes)');
  const regB = await page.$eval('#p-tab tbody tr:nth-child(6) select[data-k=regime]', s => s.value);
  assert(regB === 'SN', 'painel: regime "Simples" do CSV mapeado para SN');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#p-export')]);
  const p = await dl.path(); const conteudo = require('fs').readFileSync(p, 'utf8');
  assert(conteudo.split('\n').length >= 7 && conteudo.includes('Cliente CSV A'), 'painel: exportação CSV com resultados');
  await page.screenshot({ path: SHOTS + '/3-painel.png', fullPage: true });
  // persistência após recarregar
  await page.reload(); await page.click('#t-painel');
  assert((await page.$$('#p-tab tbody tr')).length === 6, 'painel: dados persistem após recarregar');

  // ---------- 3. Simulador de nota - NCM arroz (cesta básica)
  await page.click('#t-nota');
  await page.selectOption('#n-regime', 'LP');
  assert(await page.isHidden('#n-vserv') && await page.isHidden('#n-rbt12'), 'nota LP/NF-e: campos de NFS-e e do Simples ocultos');
  await page.fill('#n-cod', 'arroz polido');
  await page.waitForSelector('#n-sugg:not([hidden]) button[data-c]');
  assert((nt(await page.textContent('#n-sugg'))).includes('1006.30.21'), 'nota: busca por descrição encontra 1006.30.21');
  await page.fill('#n-cod', '10063021');
  await page.waitForFunction(() => document.querySelector('#n-class').options.length > 3);
  assert(await page.inputValue('#n-class') === '200003', 'nota: NCM 10063021 enquadrado automaticamente em 200003 (cesta básica)');
  assert(nt(await page.textContent('#n-enq')).includes('redução de 100%'), 'nota: quadro "Enquadramento identificado: Alíquota zero — redução de 100%"');
  await page.fill('#n-vprod', '1.000'); await page.fill('#n-vicms', '70');
  await page.click('#f-nota button[type=submit]');
  await page.waitForSelector('#n-res:not([hidden])');
  assert(nt(await page.textContent('#n-res tr.tot td.v')) === 'R$ 0,00', 'nota arroz automático: CBS + IBS = R$ 0,00 sem escolher nada');
  await page.selectOption('#n-class', '000001');
  await page.waitForFunction(() => document.querySelector('#n-enq').textContent.includes('selecionado'));
  assert(nt(await page.textContent('#n-res tr.tot td.v')) === 'R$ 106,01', 'nota: trocar para 000001 recalcula sozinho (R$ 106,01)');
  await page.click('#f-nota button[type=submit]');
  await page.waitForSelector('#n-res:not([hidden])');
  txt = nt(await page.textContent('#n-res'));
  // base 930 -> CBS 105,09 ; IBS UF 0,47 (0.465 -> half-even 0,46?) conferido contra o motor
  const RTC = require('../assets/js/engine.js');
  const ref = RTC.calcularItemRegular('930', null, RTC.PREMISSAS_PADRAO);
  const brl = v => 'R$ ' + Number(RTC.toStr(v, 2)).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  assert(txt.includes(brl(ref.vCBS)) && txt.includes(brl(ref.total)), 'nota NF-e integral: CBS ' + brl(ref.vCBS) + ' total ' + brl(ref.total));
  await page.selectOption('#n-class', '200003');
  txt = nt(await page.textContent('#n-res'));
  assert(nt(await page.textContent('#n-res tr.tot td.v')) === 'R$ 0,00', 'nota cesta básica (200003): total de CBS + IBS = R$ 0,00');
  await page.screenshot({ path: SHOTS + '/4-nota-ncm.png', fullPage: true });

  // NFS-e serviço de educação (redução 60%)
  await page.selectOption('#n-tipo', 'nbs');
  await page.fill('#n-cod', '17.19');
  await page.waitForSelector('#n-sugg:not([hidden]) button[data-c]');
  assert((await page.$$('#n-sugg button[data-c]')).length > 0, 'nota: busca por item da LC 116 (17.19) retorna NBS');
  await page.fill('#n-cod', '122011200');
  await page.waitForFunction(() => document.querySelector('#n-class').value === '200028');
  assert(nt(await page.textContent('#n-enq')).includes('Redução de 60%'), 'nota: NBS pré-escola enquadrada automaticamente em 200028 (redução de 60%)');
  await page.fill('#n-vserv', '1.200,00');
  await page.click('#f-nota button[type=submit]');
  txt = nt(await page.textContent('#n-res'));
  // Receita (doc): base 1200, red 60% -> CBS 11.3*0.4=4.52% -> 54,24 ; IBS 0.02% -> 0,24 + 0,24
  assert(txt.includes('R$ 54,24') && txt.includes('R$ 0,24'), 'nota NFS-e educação (200028): CBS R$ 54,24 / IBS UF R$ 0,24');
  await page.screenshot({ path: SHOTS + '/5-nota-nbs.png', fullPage: true });

  // contabilidade (17.19) -> 200052 automatico
  await page.fill('#n-cod', '113022100');
  await page.waitForFunction(() => document.querySelector('#n-class').value === '200052');
  await page.fill('#n-vserv', '3.000'); await page.fill('#n-siss', '150');
  await page.click('#f-nota button[type=submit]');
  assert(nt(await page.textContent('#n-res tr.tot td.v')) === 'R$ 227,44', 'nota: contabilidade enquadrada em 200052 (30%) -> total R$ 227,44');
  await page.fill('#n-cod', '122011200');
  await page.waitForFunction(() => document.querySelector('#n-class').value === '200028');
  await page.fill('#n-vserv', '1.200,00'); await page.fill('#n-siss', '');

  // Emitente do Simples
  await page.selectOption('#n-regime', 'SN');
  await page.selectOption('#n-anexo', 'III');
  await page.fill('#n-rbt12', '100.000,00');
  await page.click('#f-nota button[type=submit]');
  txt = nt(await page.textContent('#n-res'));
  // III faixa 1: pCBS 0.9258 -> 1200*0.9258% = 11,1096 -> NFS-e 2 casas: 0.93% -> 11,16 ; pIBS 0.01 -> 0,12
  assert(txt.includes('R$ 11,16') && txt.includes('R$ 0,12'), 'nota Simples NFS-e: CBS R$ 11,16 / IBS R$ 0,12 (alíquotas com 2 casas)');

  // NCM sem beneficio permanece integral
  await page.selectOption('#n-regime', 'LP'); await page.selectOption('#n-tipo', 'ncm');
  await page.fill('#n-cod', '84713012');
  await page.waitForFunction(() => document.querySelector('#n-class').options.length > 3);
  assert(await page.inputValue('#n-class') === '000001' && nt(await page.textContent('#n-enq')).includes('Tributação integral'), 'nota: notebook 84713012 fica em tributação integral (000001)');

  // NCM sujeito ao IS (cerveja)
  await page.selectOption('#n-regime', 'LR');
  await page.selectOption('#n-tipo', 'ncm');
  await page.fill('#n-cod', '22030000');
  await page.waitForSelector('#n-is-f:not([hidden])');
  assert(true, 'nota: NCM 22030000 (cerveja) exibe campo do Imposto Seletivo');

  // ---------- Premissas
  await page.click('#t-prem');
  await page.fill('#pr-cbs', '8,8'); await page.click('#f-prem button[type=submit]');
  assert((nt(await page.textContent('#meta-aliq'))).includes('8,8'), 'premissas: CBS alterada para 8,8% reflete no cabeçalho');
  await page.click('#pr-reset');
  assert((nt(await page.textContent('#meta-aliq'))).includes('11,3'), 'premissas: padrão 11,3% restaurado');

  // ---------- Celular
  const m = await browser.newContext({ ...require('playwright').devices['iPhone 13'] });
  const mp = await m.newPage(); mp.on('pageerror', e => erros.push(String(e)));
  await mp.goto(BASE); await mp.waitForSelector('#v-sim:not([hidden])');
  const sw = await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert(sw, 'celular: sem rolagem horizontal');
  await mp.screenshot({ path: SHOTS + '/6-celular.png', fullPage: false });

  assert(erros.length === 0, 'console sem erros de JS ' + (erros.length ? JSON.stringify(erros) : ''));
  await browser.close();
  console.log('\nTODOS OS TESTES PASSARAM');
})().catch(e => { console.error(e.message || e); process.exit(1); });
