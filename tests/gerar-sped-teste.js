// Gera arquivos SPED sinteticos (12 meses de EFD ICMS/IPI e EFD Contribuicoes + ECD anual + balancete CSV)
// para testar a aba "Melhor regime". Uso: node tests/gerar-sped-teste.js <pasta_saida>
const fs = require('fs'), path = require('path');
const OUT = process.argv[2] || 'tests/sped-exemplo';
fs.mkdirSync(OUT, { recursive: true });
const CNPJ = '11222333000181', NOME = 'COMERCIAL TESTE LTDA';
const L = a => '|' + a.join('|') + '|';
const v = x => x.toFixed(2).replace('.', ',');
const meses = []; for (let i = 0; i < 12; i++) { const d = new Date(2025, 10 + i, 1); meses.push([d.getFullYear(), d.getMonth() + 1]); }
const ult = (a, m) => new Date(a, m, 0).getDate();
const dt = (d, m, a) => String(d).padStart(2, '0') + String(m).padStart(2, '0') + a;

meses.forEach(([a, m], i) => {
  const ini = dt(1, m, a), fim = dt(ult(a, m), m, a), exp = i === 5 ? 10000 : 0;
  // ---------------- EFD ICMS/IPI
  const e = [];
  e.push(L(['0000', '019', '0', ini, fim, NOME, CNPJ, '', 'SP', '123456789110', '3509502', '', '', 'A', '1']));
  e.push(L(['0001', '0']));
  e.push(L(['0150', 'CLI1', 'CLIENTE PJ SA', '01058', '99888777000166', '', '', '3509502', '', 'RUA A', '1', '', 'CENTRO']));
  e.push(L(['0150', 'EXT1', 'FOREIGN BUYER', '00132', '', '', '', '9999999', '', 'STREET', '1', '', '']));
  e.push(L(['0150', 'FOR1', 'DISTRIBUIDORA ALFA SA', '01058', '10000000000191', '', '', '3509502', '', 'RUA B', '2', '', 'CENTRO']));
  e.push(L(['0200', 'ARROZ', 'ARROZ TIPO 1 5KG', '', '', 'UN', '00', '10063021', '', '10', '', '0']));
  e.push(L(['0200', 'SABON', 'SABONETE 90G', '', '', 'UN', '00', '34011190', '', '34', '', '18']));
  e.push(L(['0200', 'NOTE', 'NOTEBOOK 14 POL', '', '', 'UN', '00', '84713012', '', '84', '', '18']));
  e.push(L(['C001', '0']));
  // venda NF-e a PJ (sem C170 para NF-e propria) + C190
  e.push(L(['C100', '1', '0', 'CLI1', '55', '00', '1', String(1000 + i), '', ini, ini, v(80000), '0', '0', '0', v(80000), '9', '0', '0', '0', v(80000), v(14400), '0', '0', '0', '0', '0', '0', '0']));
  e.push(L(['C190', '000', '5102', '18', v(80000), v(80000), v(14400), '0', '0', '0', '0', '']));
  // NFC-e a consumidor final (sem participante)
  e.push(L(['C100', '1', '0', '', '65', '00', '1', String(5000 + i), '', ini, ini, v(20000), '0', '0', '0', v(20000), '9', '0', '0', '0', v(20000), v(3600), '0', '0', '0', '0', '0', '0', '0']));
  e.push(L(['C190', '000', '5102', '18', v(20000), v(20000), v(3600), '0', '0', '0', '0', '']));
  // nota cancelada (deve ser ignorada)
  e.push(L(['C100', '1', '0', 'CLI1', '55', '02', '1', String(9000 + i), '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']));
  if (exp) { e.push(L(['C100', '1', '0', 'EXT1', '55', '00', '1', String(7000 + i), '', ini, ini, v(exp), '0', '0', '0', v(exp), '9', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'])); e.push(L(['C190', '041', '7102', '0', v(exp), '0', '0', '0', '0', '0', '0', ''])); }
  // devolucao de venda (entrada CFOP 1202) e compras (1102)
  e.push(L(['C100', '0', '1', 'CLI1', '55', '00', '1', String(3000 + i), '', ini, ini, v(1000), '0', '0', '0', v(1000), '9', '0', '0', '0', v(1000), v(180), '0', '0', '0', '0', '0', '0', '0']));
  e.push(L(['C170', '1', 'SABON', '', '100', 'UN', v(1000), '0', '0', '000', '1202', '', v(1000), '18', v(180), '0', '0', '0', '0', '', '', '0', '0', '0', '01', '0', '0', '', '', '0', '01', '0', '0', '', '', '0', '', '']));
  e.push(L(['C190', '000', '1202', '18', v(1000), v(1000), v(180), '0', '0', '0', '0', '']));
  e.push(L(['C100', '0', '1', 'FOR1', '55', '00', '1', String(4000 + i), '', ini, ini, v(50000), '0', '0', '0', v(50000), '9', '0', '0', '0', v(50000), v(6000), '0', '0', '0', '0', '0', '0', '0']));
  e.push(L(['C190', '000', '1102', '12', v(50000), v(50000), v(6000), '0', '0', '0', '0', '']));
  e.push(L(['E001', '0'])); e.push(L(['E100', ini, fim]));
  // E110: debitos 18.000 - creditos 6.000 (+180 estorno da devolucao ignorado no exemplo) = 12.000 a recolher
  e.push(L(['E110', v(18000), '0', '0', '0', v(6000), '0', '0', '0', '0', v(12000), '0', v(12000), '0', '0']));
  e.push(L(['9999', String(e.length + 1)]));
  fs.writeFileSync(path.join(OUT, `efd-icms-${a}${String(m).padStart(2, '0')}.txt`), e.join('\r\n') + '\r\n', 'latin1');

  // ---------------- EFD Contribuicoes (regime cumulativo)
  const c = [];
  c.push(L(['0000', '006', '0', '', '', ini, fim, NOME, CNPJ, 'SP', '3509502', '', '00', '1']));
  c.push(L(['0001', '0'])); c.push(L(['0110', '2', '', '', '9']));
  c.push(L(['0140', '', NOME, CNPJ, 'SP', '', '3509502', '', '']));
  c.push(L(['0150', 'CLI1', 'CLIENTE PJ SA', '01058', '99888777000166', '', '', '3509502', '', 'RUA A', '1', '', 'CENTRO']));
  c.push(L(['0150', 'CLI2', 'ESCRITORIO CLIENTE LTDA', '01058', '88777666000155', '', '', '3509502', '', 'RUA C', '3', '', 'CENTRO']));
  c.push(L(['0200', 'ARROZ', 'ARROZ TIPO 1 5KG', '', '', 'UN', '00', '10063021', '', '10', '', '0']));
  c.push(L(['0200', 'SABON', 'SABONETE 90G', '', '', 'UN', '00', '34011190', '', '34', '', '18']));
  c.push(L(['0200', 'NOTE', 'NOTEBOOK 14 POL', '', '', 'UN', '00', '84713012', '', '84', '', '18']));
  c.push(L(['0200', 'CONTAB', 'SERVICOS DE CONTABILIDADE', '', '', 'UN', '09', '', '', '', '17.19', '']));
  c.push(L(['A001', '0'])); c.push(L(['A010', CNPJ]));
  c.push(L(['A100', '1', '0', 'CLI2', '00', '1', '', String(200 + i), '', ini, ini, v(10000), '0', '0', v(10000), v(65), v(10000), v(300), '0', '0', v(500)]));
  c.push(L(['A170', '1', 'CONTAB', '', v(10000), '0', '', '', '01', v(10000), '0,65', v(65), '01', v(10000), '3', v(300), '', '']));
  c.push(L(['C001', '0'])); c.push(L(['C010', CNPJ, '1']));
  c.push(L(['C100', '1', '0', 'CLI1', '55', '00', '1', String(1000 + i), '', ini, ini, v(100000), '0', '0', '0', v(100000), '9', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0']));
  const item = (n, cod, val, cst) => L(['C170', String(n), cod, '', '1', 'UN', v(val), '0', '0', '000', '5102', '', '0', '0', '0', '0', '0', '0', '0', '', '', '0', '0', '0', cst, v(val), '0,65', '', '', v(val * 0.0065), cst, v(val), '3', '', '', v(val * 0.03), '', '']);
  c.push(item(1, 'ARROZ', 30000, '06')); c.push(item(2, 'SABON', 20000, '01')); c.push(item(3, 'NOTE', 50000, '01'));
  const pis = (100000 - 30000 + 10000 + exp * 0) * 0.0065, cof = (100000 - 30000 + 10000) * 0.03;
  c.push(L(['M001', '0']));
  c.push(L(['M200', '0', '0', '0', '0', '0', '0', '0', v(pis), '0', '0', v(pis), v(pis)]));
  c.push(L(['M600', '0', '0', '0', '0', '0', '0', '0', v(cof), '0', '0', v(cof), v(cof)]));
  c.push(L(['9999', String(c.length + 1)]));
  fs.writeFileSync(path.join(OUT, `efd-contribuicoes-${a}${String(m).padStart(2, '0')}.txt`), c.join('\r\n') + '\r\n', 'latin1');
});

// ---------------- ECD anual (I050 + I355)
const contas = [
  ['3.1.01', 'C', 'Receita de vendas de mercadorias', 1210000], ['3.1.02', 'C', 'Receita de serviços prestados', 120000],
  ['3.1.03', 'D', '(-) Devoluções de vendas', 12000], ['3.1.04', 'D', '(-) ICMS sobre vendas', 144000], ['3.1.05', 'D', '(-) PIS e COFINS sobre faturamento', 48180],
  ['3.2.01', 'D', 'Custo das mercadorias vendidas', 660000], ['3.3.01', 'D', 'Salários e ordenados', 180000], ['3.3.02', 'D', 'INSS patronal', 50040],
  ['3.3.03', 'D', 'FGTS', 14400], ['3.3.04', 'D', 'Pró-labore', 36000], ['3.3.05', 'D', 'Aluguel', 60000], ['3.3.06', 'D', 'Energia elétrica', 24000],
  ['3.3.07', 'D', 'Depreciação', 12000], ['3.3.08', 'D', 'Tarifas bancárias', 6000], ['3.4.01', 'C', 'Receitas financeiras', 8000], ['3.5.01', 'D', 'Provisão para IRPJ e CSLL', 30000]
];
const ecd = [L(['0000', 'LECD', '01112025', '31102026', NOME, CNPJ, 'SP', '', '3509502', '', '0', '0', '0', '', '0', '0', '', 'N', 'N', '0', '0', '1'])];
ecd.push(L(['I001', '0']));
ecd.push(L(['I050', '01112025', '04', 'S', '1', '3', '', 'RESULTADO']));
contas.forEach(([cod, , desc]) => ecd.push(L(['I050', '01112025', '04', 'A', '4', cod, '3', desc])));
ecd.push(L(['I350', '31102026']));
contas.forEach(([cod, dc, , val]) => ecd.push(L(['I355', cod, '', v(val), dc])));
ecd.push(L(['9999', String(ecd.length + 1)]));
fs.writeFileSync(path.join(OUT, 'ecd-2026.txt'), ecd.join('\r\n') + '\r\n', 'latin1');

// ---------------- balancete CSV (alternativa a ECD; inclui contas sinteticas e patrimoniais que devem ser ignoradas)
const bal = ['Código;Descrição da conta;Saldo anterior;Débito;Crédito;Saldo atual',
  '1;ATIVO;0;0;0;500.000,00D', '1.1.01;Caixa e bancos;0;0;0;80.000,00D', '2.1.01;Salários a pagar;0;0;0;15.000,00C', '3;RESULTADO;0;0;0;0',
  '3.1;RECEITAS;0;0;0;1.338.000,00C'];
contas.forEach(([cod, dc, desc, val]) => bal.push(`${cod};${desc};0;${dc === 'D' ? v(val) : '0'};${dc === 'C' ? v(val) : '0'};${v(val)}${dc}`));
fs.writeFileSync(path.join(OUT, 'balancete-12m.csv'), '﻿' + bal.join('\n') + '\n', 'utf8');
console.log('SPED de teste gerado em', OUT);
