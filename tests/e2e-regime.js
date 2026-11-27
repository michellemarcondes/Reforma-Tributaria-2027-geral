// Teste no navegador da aba "Melhor regime 2027".
// Uso: node tests/e2e-regime.js <url> <pasta_sped> <pasta_screenshots>
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const [BASE, DIR, SHOTS] = process.argv.slice(2);
const nt = s => String(s).replace(/ /g, ' ');
const assert = (c, m) => { if (!c) throw new Error('FALHOU: ' + m); console.log('ok -', m); };
function zipar(arqs, destino) { // zip simples (deflate) para o teste
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const loc = [], cen = []; let off = 0;
  for (const [nome, dados] of arqs) {
    const comp = zlib.deflateRawSync(dados), nm = Buffer.from(nome), c = crc(dados);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(c, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(dados.length, 22); h.writeUInt16LE(nm.length, 26);
    loc.push(h, nm, comp);
    const d = Buffer.alloc(46); d.writeUInt32LE(0x02014b50, 0); d.writeUInt16LE(20, 4); d.writeUInt16LE(20, 6); d.writeUInt16LE(8, 10); d.writeUInt32LE(c, 16); d.writeUInt32LE(comp.length, 20); d.writeUInt32LE(dados.length, 24); d.writeUInt16LE(nm.length, 28); d.writeUInt32LE(off, 42);
    cen.push(d, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(cen), f = Buffer.alloc(22); f.writeUInt32LE(0x06054b50, 0); f.writeUInt16LE(arqs.length, 8); f.writeUInt16LE(arqs.length, 10); f.writeUInt32LE(cd.length, 12); f.writeUInt32LE(off, 16);
  fs.writeFileSync(destino, Buffer.concat([...loc, cd, f]));
}
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const erros = []; page.on('pageerror', e => erros.push(String(e))); page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
  await page.goto(BASE + '#melhor-regime');
  await page.waitForSelector('#v-regime:not([hidden])');
  assert(true, 'aba "Melhor regime 2027" abre pelo link #melhor-regime');
  const arqs = fs.readdirSync(DIR).map(f => path.join(DIR, f));
  await page.setInputFiles('#r-files', arqs);
  await page.waitForSelector('#r-dados:not([hidden])');
  let txt = nt(await page.textContent('#r-arqs'));
  assert(txt.includes('12 EFD ICMS/IPI') && txt.includes('12 EFD Contribuições') && txt.includes('1 ECD') && txt.includes('1 Balancete'), 'arquivos identificados: 12 EFD ICMS/IPI, 12 EFD Contribuições, 1 ECD, 1 balancete');
  assert(txt.includes('11.222.333/0001-81') && txt.includes('11/2025') && txt.includes('10/2026'), 'CNPJ e período (11/2025 a 10/2026)');
  assert(nt(await page.inputValue('#r-receitaMerc')) === '1.210.000,00' && nt(await page.inputValue('#r-receitaServ')) === '120.000,00' && nt(await page.inputValue('#r-icms')) === '144.000,00', 'campos pré-preenchidos: receita de mercadorias, serviços e ICMS');
  assert(nt(await page.inputValue('#r-cmv')) === '660.000,00' && nt(await page.inputValue('#r-folha')) === '180.000,00' && nt(await page.inputValue('#r-comprasCredito')) === '528.000,00', 'DRE (ECD) e base de crédito das compras pré-preenchidas');
  assert(nt(await page.inputValue('#r-b2b')) === '81,8' && (await page.inputValue('#r-atual')) === 'LP' && (await page.inputValue('#r-nome')) === 'COMERCIAL TESTE LTDA', 'B2B 81,8%, regime atual Presumido (EFD Contribuições cumulativa) e nome da empresa');
  txt = nt(await page.textContent('#r-ben'));
  assert(/Alíquota zero.*R\$ 360\.000,00/.test(txt) && /Redução de 60%.*R\$ 240\.000,00/.test(txt) && /Redução de 30%.*R\$ 120\.000,00/.test(txt), 'benefícios: arroz alíquota zero, sabonete −60%, contabilidade −30%');
  await page.click('#r-gerar');
  await page.waitForSelector('#r-res:not([hidden]) .ct');
  txt = nt(await page.textContent('#r-res'));
  assert(txt.includes('Simples Nacional híbrido') && txt.includes('R$ 122.527,51'), 'melhor regime: Simples híbrido, R$ 122.527,51');
  assert(txt.includes('R$ 263.529,07') && txt.includes('R$ 255.463,54') && txt.includes('R$ 123.856,76'), 'totais: Presumido 263.529,07 · Real 255.463,54 · Simples 123.856,76');
  assert(txt.includes('R$ 141.001,56') && txt.includes('Avaliar mudança'), 'economia de R$ 141.001,56 em relação ao Presumido');
  assert(txt.includes('81,8%') && txt.includes('[Fonte 6]') && txt.includes('[Fonte 4]'), 'alerta B2B e citações das fontes do caderno');
  await page.screenshot({ path: SHOTS + '/regime-1.png', fullPage: true });
  // simples impedido: compara so Presumido x Real
  await page.check('#r-imped'); await page.click('#r-gerar');
  txt = nt(await page.textContent('#r-res'));
  const ths = await page.$$eval('#r-res table thead th', t => t.map(x => x.textContent));
  assert(txt.includes('R$ 8.065,53') && ths.length === 3 && ths.join('|').includes('Lucro Real') && !ths.join('|').includes('Simples') && /Margem real[\s\S]*13,7%/.test(txt), 'com impedimento ao Simples: só Presumido × Real; Real vence por R$ 8.065,53 (margem 10,8% < equilíbrio 13,7%)');
  await page.uncheck('#r-imped');
  // edicao manual: prejuizo fiscal muda o Real
  await page.fill('#r-prejuizo', '100.000'); await page.click('#r-gerar');
  txt = nt(await page.textContent('#r-res'));
  assert(txt.includes('R$ 37.908,00'), 'prejuízo fiscal: compensação limitada a 30% do lucro (R$ 37.908,00)');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#r-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert(csv.includes('Lucro Presumido;') && csv.includes('Simples híbrido;'), 'exportação do comparativo em CSV');
  // .zip com os mesmos arquivos (pagina nova)
  const zipPath = path.join(SHOTS, 'sped.zip'); zipar(fs.readdirSync(DIR).map(f => ['sped/' + f, fs.readFileSync(path.join(DIR, f))]), zipPath);
  const p2 = await ctx.newPage(); p2.on('pageerror', e => erros.push(String(e)));
  await p2.goto(BASE + '#melhor-regime'); await p2.waitForSelector('#v-regime:not([hidden])');
  await p2.setInputFiles('#r-files', zipPath); await p2.waitForSelector('#r-dados:not([hidden])');
  assert(nt(await p2.inputValue('#r-receitaMerc')) === '1.210.000,00', 'arquivos dentro de .zip lidos');
  // modo manual sem arquivos
  const p3 = await ctx.newPage(); p3.on('pageerror', e => erros.push(String(e)));
  await p3.goto(BASE + '#melhor-regime'); await p3.waitForSelector('#v-regime:not([hidden])');
  await p3.click('#r-manual');
  await p3.fill('#r-receitaServ', '600.000'); await p3.fill('#r-folha', '200.000'); await p3.fill('#r-despSemCred', '100.000'); await p3.selectOption('#r-anxs', 'III/V'); await p3.selectOption('#r-atual', 'LP');
  await p3.click('#r-gerar'); await p3.waitForSelector('#r-res:not([hidden]) .ct');
  txt = nt(await p3.textContent('#r-res'));
  assert(txt.includes('Fator R') && txt.includes('33,3%') && txt.includes('Anexo III'), 'modo manual (serviços): Fator R 33,3% → Anexo III');
  // celular
  const m = await browser.newContext({ ...devices['iPhone 13'] });
  const mp = await m.newPage(); mp.on('pageerror', e => erros.push(String(e)));
  await mp.goto(BASE + '#melhor-regime'); await mp.waitForSelector('#v-regime:not([hidden])');
  await mp.setInputFiles('#r-files', arqs); await mp.waitForSelector('#r-dados:not([hidden])'); await mp.click('#r-gerar'); await mp.waitForSelector('#r-res:not([hidden]) .ct');
  assert(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem horizontal da página');
  assert(erros.length === 0, 'console sem erros de JS ' + (erros.length ? JSON.stringify(erros) : ''));
  await browser.close();
  console.log('\nTESTES DA ABA MELHOR REGIME PASSARAM');
})().catch(e => { console.error(e.message || e); process.exit(1); });
