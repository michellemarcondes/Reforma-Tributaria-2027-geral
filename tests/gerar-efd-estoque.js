// Gera EFD ICMS/IPI (jan-out/2026, Bloco H de 31/12/2025 na EFD de fev), EFD Contribuicoes (saidas por item)
// e um XML de compra de fornecedor do Simples, para testar a projecao do estoque.
// Uso: node tests/gerar-efd-estoque.js <pasta_saida>
const fs = require('fs'), path = require('path');
const OUT = process.argv[2] || 'tests/efd-estoque'; fs.mkdirSync(OUT, { recursive: true });
const CNPJ = '11222333000181', NOME = 'COMERCIAL TESTE LTDA';
const L = a => '|' + a.join('|') + '|', v = x => x.toFixed(2).replace('.', ',');
const dt = (d, m, a) => String(d).padStart(2, '0') + String(m).padStart(2, '0') + a;
const chaveSN = m => '35' + '2606' + '20000000000110' + '55001' + String(800000000 + m).padStart(9, '0') + '1' + '000000000';
const c170 = (n, cod, q, val, cfop, icms, cst) => L(['C170', String(n), cod, '', String(q), 'UN', v(val), '0', '0', '000', cfop, '', v(val), '18', v(icms), '0', '0', '0', '0', '', '', '0', '0', '0', cst, v(val), '0,65', '', '', '0', cst, v(val), '3', '', '', '0', '', '']);
const cad = [L(['0200', 'ARROZ', 'ARROZ TIPO 1', '', '', 'UN', '00', '10063021', '', '10', '', '0']), L(['0200', 'SABON', 'SABONETE 90G', '', '', 'UN', '00', '34011190', '', '34', '', '18']),
  L(['0200', 'NOTE', 'NOTEBOOK 14', '', '', 'UN', '00', '84713012', '', '84', '', '18']), L(['0200', 'UNIF', 'UNIFORME FUNCIONARIOS', '', '', 'UN', '07', '62034200', '', '62', '', '18']),
  L(['0200', 'CAIXA', 'CAIXA DE PAPELAO', '', '', 'UN', '00', '48191000', '', '48', '', '18'])];
for (let m = 1; m <= 10; m++) {
  const ini = dt(1, m, 2026), fim = dt(new Date(2026, m, 0).getDate(), m, 2026);
  const part = [L(['0150', 'FOR1', 'DISTRIBUIDORA ALFA SA', '01058', '10000000000191', '', '', '3509502', '', 'RUA', '1', '', '']), L(['0150', 'FOR2', 'PEQUENO FORNECEDOR ME', '01058', '20000000000110', '', '', '3509502', '', 'RUA', '2', '', '']), L(['0150', 'CLI1', 'CLIENTE PJ SA', '01058', '99888777000166', '', '', '3509502', '', 'RUA', '3', '', ''])];
  const e = [L(['0000', '019', '0', ini, fim, NOME, CNPJ, '', 'SP', '123', '3509502', '', '', 'A', '1']), L(['0001', '0'])].concat(part, cad);
  e.push(L(['C001', '0']));
  // entradas (C170 obrigatorio em notas de terceiros)
  e.push(L(['C100', '0', '1', 'FOR1', '55', '00', '1', String(100 + m), '35260610000000000191550010000001011000000010', ini, ini, v(18000), '0', '0', '0', v(18000), '9', '0', '0', '0', v(18000), v(1320), '0', '0', '0', '0', '0', '0', '0']));
  e.push(c170(1, 'ARROZ', 500, 5000, '1102', 0, '06'));
  e.push(c170(2, 'SABON', 1000, 2000, '1102', 0, '01'));
  e.push(c170(3, 'NOTE', 5, 11000, '1102', 1320, '01'));
  e.push(L(['C100', '0', '1', 'FOR2', '55', '00', '1', String(200 + m), chaveSN(m), ini, ini, v(900), '0', '0', '0', v(900), '9', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0']));
  e.push(c170(1, 'CAIXA', 300, 900, '1102', 0, '49'));
  // venda NF-e propria: so C190 na EFD ICMS
  e.push(L(['C100', '1', '0', 'CLI1', '55', '00', '1', String(300 + m), '', ini, ini, v(20000), '0', '0', '0', v(20000), '9', '0', '0', '0', v(20000), v(3600), '0', '0', '0', '0', '0', '0', '0']));
  e.push(L(['C190', '000', '5102', '18', v(20000), v(20000), v(3600), '0', '0', '0', '0', '']));
  if (m === 2) { // inventario de 31/12/2025 (Bloco H na EFD de fevereiro)
    e.push(L(['H001', '0'])); e.push(L(['H005', dt(31, 12, 2025), v(35500), '01']));
    e.push(L(['H010', 'ARROZ', 'UN', '1000', '10', v(10000), '0', '', '', '', '']));
    e.push(L(['H010', 'SABON', 'UN', '2000', '2', v(4000), '0', '', '', '', '']));
    e.push(L(['H010', 'NOTE', 'UN', '10', '2000', v(20000), '0', '', '', '', '']));
    e.push(L(['H010', 'UNIF', 'UN', '50', '30', v(1500), '0', '', '', '', '']));
    e.push(L(['H010', 'CONSIG', 'UN', '10', '100', v(1000), '2', 'TER1', '', '', '']));   // de terceiros: ignorar
  }
  e.push(L(['9999', String(e.length + 1)]));
  fs.writeFileSync(path.join(OUT, `efd-icms-2026${String(m).padStart(2, '0')}.txt`), e.join('\r\n') + '\r\n', 'latin1');
  // EFD Contribuicoes: itens vendidos (C170 de saida)
  const c = [L(['0000', '006', '0', '', '', ini, fim, NOME, CNPJ, 'SP', '3509502', '', '00', '1']), L(['0110', '2', '', '', '9'])].concat(cad);
  c.push(L(['C001', '0'])); c.push(L(['C010', CNPJ, '1']));
  c.push(L(['C100', '1', '0', 'CLI1', '55', '00', '1', String(300 + m), '', ini, ini, v(20000), '0', '0', '0', v(20000), '9', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0']));
  c.push(c170(1, 'ARROZ', 400, 6000, '5102', 0, '06'));
  c.push(c170(2, 'SABON', 900, 3600, '5102', 0, '01'));
  c.push(c170(3, 'NOTE', 4, 10400, '5102', 0, '01'));
  c.push(L(['9999', String(c.length + 1)]));
  fs.writeFileSync(path.join(OUT, `efd-contrib-2026${String(m).padStart(2, '0')}.txt`), c.join('\r\n') + '\r\n', 'latin1');
  // XML da compra do fornecedor do Simples (para identificar o CRT)
  if (m === 10) {
    const x = `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chaveSN(m)}"><ide><mod>55</mod><serie>1</serie><nNF>${200 + m}</nNF><dhEmi>2026-10-01T10:00:00-03:00</dhEmi><tpNF>1</tpNF><finNFe>1</finNFe></ide><emit><CNPJ>20000000000110</CNPJ><xNome>Pequeno Fornecedor ME</xNome><enderEmit><UF>SP</UF></enderEmit><CRT>1</CRT></emit><dest><CNPJ>${CNPJ}</CNPJ><xNome>${NOME}</xNome></dest><det nItem="1"><prod><cProd>CX</cProd><xProd>Caixa de papelao</xProd><NCM>48191000</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>300</qCom><vProd>900.00</vProd></prod><imposto><ICMS><ICMSSN102><CSOSN>102</CSOSN></ICMSSN102></ICMS><PIS><PISOutr><CST>49</CST></PISOutr></PIS></imposto></det></infNFe></NFe><protNFe><infProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
    fs.writeFileSync(path.join(OUT, 'nf-simples-out.xml'), x);
  }
}
console.log('EFD de estoque gerada em', OUT);
