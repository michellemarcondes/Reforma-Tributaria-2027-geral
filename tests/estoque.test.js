// Teste do motor do credito de estoque com os XMLs gerados por tests/gerar-xmls-teste.js
// Uso: node tests/estoque.test.js <pasta_xmls> <pasta_zip>
const fs = require('fs'), path = require('path');
const E = require('../assets/js/estoque.js');
const DIR = process.argv[2], ZDIR = process.argv[3];
const ok = (c, m) => { if (!c) { console.error('FALHOU: ' + m); process.exit(1); } console.log('ok -', m); };
const s2 = v => E.toStr(v, 2);

(async () => {
  const lidas = fs.readdirSync(DIR).sort().map(f => E.lerXml(E.decodificarXml(new Uint8Array(fs.readFileSync(path.join(DIR, f)))), f));
  const r = E.consolidar(lidas, { regime: 'LP' });
  ok(r.cnpjEmpresa === '11222333000181', 'CNPJ da empresa detectado automaticamente');
  ok(r.resumo.canceladas === 1 && r.resumo.duplicadas === 1 && r.resumo.saidasProprias === 1, 'cancelada, duplicada e venda própria descartadas');
  const por = id => r.produtos.find(p => p.cProd === id && (id !== 'P100' || p.cnpjFornecedor === '10000000000191'));
  ok(por('P100').qCompra === E.D('1500') && s2(por('P100').custo) === '2738.00', 'P100: duas compras agregadas (1.500 un, custo R$ 2.738,00)');
  ok(s2(por('C10').custo) === '3450.00' && por('C10').monofasico, 'ST/monofásico: custo inclui ICMS-ST (R$ 3.450,00)');
  ok(por('A1').situacao === 'nao' && /alíquota zero/.test(por('A1').motivo), 'arroz com CST 06: não elegível (alíquota zero)');
  ok(por('S1').situacao === 'revisar', 'fornecedor do Simples: revisar');
  ok(por('M1').situacao === 'nao' && /imobilizado/i.test(por('M1').motivo), 'CFOP 5551: ativo imobilizado excluído');
  ok(r.produtos.some(p => p.cProd === 'P100' && p.situacao === 'nao' && /Transfer/.test(p.motivo)), 'transferência da filial excluída');
  ok(por('D1').situacao === 'nao', 'devolução excluída');
  ok(!r.produtos.some(p => p.cProd === 'X1'), 'item da nota cancelada não aparece');
  ok(por('IMP1').importacao && por('IMP1').situacao === 'elegivel', 'importação elegível (PIS/Cofins-Importação)');
  ok(por('L1').xProd === 'Sabão em barra ação rápida', 'XML ISO-8859-1 lido com acentos');
  const t = E.totalizar(r.produtos, { regime: 'LP' }, 0);
  ok(s2(t.credito) === '3009.14', 'crédito total = R$ 3.009,14 (cálculo manual)');
  ok(s2(t.potencialRevisar) === '83.25', 'crédito potencial em revisão = R$ 83,25');
  const c = E.cronograma(t.credito, 3);
  ok(c.length === 12 && s2(c[0].valor) === '250.76' && s2(c[11].valor) === '250.78' && c[0].mes === 3 && c[11].mes === 2 && c[11].ano === 2028, 'cronograma: 12 parcelas de março/2027 a fevereiro/2028 (11 × 250,76 + 250,78)');
  ok(s2(c.reduce((a, x) => a + x.valor, 0n)) === '3009.14', 'soma das parcelas = crédito total');
  // quantidade em estoque parcial
  por('P100').qEstoque = E.D('750');
  const t2 = E.totalizar(r.produtos, { regime: 'LP' }, 0);
  ok(s2(por('P100')._calc.valorEstoque) === '1369.00' && s2(por('P100')._calc.credito) === '126.63', 'estoque parcial: metade do P100 (R$ 1.369,00 → crédito R$ 126,63)');
  por('P100').qEstoque = por('P100').qCompra;
  // Lucro Real: so monofasico/ST e importacao?
  const rLR = E.consolidar(lidas, { regime: 'LR' });
  const tLR = E.totalizar(rLR.produtos, { regime: 'LR' }, 0);
  ok(s2(tLR.credito) === '319.12', 'Lucro Real: só o item monofásico/ST gera crédito (R$ 319,12)');
  // outros estoques sem XML
  const t3 = E.totalizar(r.produtos, { regime: 'LP' }, '10000');
  ok(s2(t3.credito) === '3934.14', 'outros estoques sem XML (R$ 10.000) somam R$ 925,00');
  // ZIP
  const zbytes = new Uint8Array(fs.readFileSync(path.join(ZDIR, 'notas.zip')));
  const ents = E.listarZip(zbytes);
  ok(ents.length === 3, 'ZIP: 3 arquivos listados');
  const doZip = [];
  for (const e of ents) doZip.push(E.lerXml(E.decodificarXml(await e.ler()), e.nome));
  ok(doZip.every(n => n.tipo === 'nfe') && doZip.some(n => n.itens[0].xProd === 'Sabão em barra ação rápida'), 'ZIP: XMLs descompactados e lidos (inclusive latin1)');
  console.log('\nTESTES DO CRÉDITO DE ESTOQUE PASSARAM');
})();
