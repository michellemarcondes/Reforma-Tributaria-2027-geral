// Gera XMLs de NF-e sinteticos (e um .zip) para testar o credito de estoque.
// Uso: node tests/gerar-xmls-teste.js <pasta_saida>
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const OUT = process.argv[2] || 'tests/xml-exemplo';
fs.mkdirSync(OUT, { recursive: true });
const EMPRESA = { cnpj: '11222333000181', nome: 'Comercial Exemplo Ltda' };
let seq = 0;
function chave(cnpj, n) { const base = ('35' + '2610' + cnpj + '55' + '001' + String(n).padStart(9, '0') + '1' + String(n).padStart(8, '0')).slice(0, 43); return base + '0'; }
function item(i, o) {
  const icms = o.cstICMS === '60' || o.csosn ? (o.csosn ? `<ICMSSN102><orig>0</orig><CSOSN>${o.csosn}</CSOSN></ICMSSN102>` : `<ICMS60><orig>0</orig><CST>60</CST></ICMS60>`)
    : o.vICMSST ? `<ICMS10><orig>0</orig><CST>10</CST><vBC>${o.vProd}</vBC><pICMS>18</pICMS><vICMS>${o.vICMS || '0.00'}</vICMS><vBCST>1</vBCST><pICMSST>18</pICMSST><vICMSST>${o.vICMSST}</vICMSST></ICMS10>`
    : `<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>${o.vProd}</vBC><pICMS>18</pICMS><vICMS>${o.vICMS || '0.00'}</vICMS></ICMS00>`;
  const ipi = o.vIPI ? `<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>${o.vProd}</vBC><pIPI>10</pIPI><vIPI>${o.vIPI}</vIPI></IPITrib></IPI>` : '';
  const pisTag = ['04', '05', '06', '07', '08', '09'].includes(o.cstPIS) ? 'PISNT' : 'PISAliq', cofTag = pisTag === 'PISNT' ? 'COFINSNT' : 'COFINSAliq';
  const ii = o.vII ? `<II><vBC>${o.vProd}</vBC><vDespAdu>0.00</vDespAdu><vII>${o.vII}</vII><vIOF>0.00</vIOF></II>` : '';
  return `<det nItem="${i}"><prod><cProd>${o.cProd}</cProd><cEAN>SEM GTIN</cEAN><xProd>${o.xProd}</xProd><NCM>${o.NCM}</NCM><CFOP>${o.CFOP}</CFOP><uCom>${o.uCom || 'UN'}</uCom><qCom>${o.qCom}</qCom><vUnCom>${(Number(o.vProd) / Number(o.qCom)).toFixed(4)}</vUnCom><vProd>${o.vProd}</vProd>` +
    (o.vFrete ? `<vFrete>${o.vFrete}</vFrete>` : '') + (o.vDesc ? `<vDesc>${o.vDesc}</vDesc>` : '') + `<indTot>1</indTot></prod>` +
    `<imposto><ICMS>${icms}</ICMS>${ipi}${ii}<PIS><${pisTag}><CST>${o.cstPIS || '01'}</CST>${o.vPIS ? `<vBC>${o.vProd}</vBC><pPIS>2.10</pPIS><vPIS>${o.vPIS}</vPIS>` : ''}</${pisTag}></PIS><COFINS><${cofTag}><CST>${o.cstPIS || '01'}</CST>${o.vCOFINS ? `<vBC>${o.vProd}</vBC><pCOFINS>9.65</pCOFINS><vCOFINS>${o.vCOFINS}</vCOFINS>` : ''}</${cofTag}></COFINS></imposto></det>`;
}
function nfe(nome, o) {
  const n = ++seq, emit = o.emit || { cnpj: '10000000000191', nome: 'Distribuidora Alfa SA', crt: '3' };
  const dest = o.dest || EMPRESA, ch = o.chave || chave(emit.cnpj, n);
  const enc = o.latin1 ? 'ISO-8859-1' : 'UTF-8';
  const xml = `<?xml version="1.0" encoding="${enc}"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="NFe${ch}">` +
    `<ide><cUF>35</cUF><natOp>Venda</natOp><mod>55</mod><serie>1</serie><nNF>${o.nNF || n}</nNF><dhEmi>${o.data || '2026-10-15'}T10:00:00-03:00</dhEmi><tpNF>${o.tpNF || '1'}</tpNF><idDest>1</idDest><finNFe>${o.finNFe || '1'}</finNFe></ide>` +
    `<emit><CNPJ>${emit.cnpj}</CNPJ><xNome>${emit.nome}</xNome><enderEmit><UF>SP</UF></enderEmit><CRT>${emit.crt || '3'}</CRT></emit>` +
    `<dest><CNPJ>${dest.cnpj}</CNPJ><xNome>${dest.nome}</xNome><enderDest><UF>SP</UF></enderDest></dest>` +
    o.itens.map((it, i) => item(i + 1, it)).join('') +
    `<total><ICMSTot><vProd>0</vProd></ICMSTot></total></infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>${ch}</chNFe><cStat>${o.cStat || '100'}</cStat></infProt></protNFe></nfeProc>`;
  fs.writeFileSync(path.join(OUT, nome), o.latin1 ? Buffer.from(xml, 'latin1') : xml);
  return { ch, xml };
}
const FORN_SN = { cnpj: '20000000000110', nome: 'Pequeno Fornecedor ME', crt: '1' };
const FORN_B = { cnpj: '30000000000105', nome: 'Industria Beta Ltda', crt: '3' };

// 1. revenda comum: 2 itens; ICMS, IPI, frete e desconto
const n1 = nfe('nf001-revenda.xml', { itens: [
  { cProd: 'P100', xProd: 'Parafuso sextavado 6mm', NCM: '73181500', CFOP: '5102', qCom: '1000', vProd: '2000.00', vICMS: '360.00', vIPI: '100.00', vFrete: '50.00', vDesc: '20.00' },
  { cProd: 'P200', xProd: 'Porca 6mm', NCM: '73181600', CFOP: '5102', qCom: '500', vProd: '500.00', vICMS: '90.00' }] });
// 2. ICMS-ST com PIS/Cofins monofasico (CST 04) - cosmeticos
nfe('nf002-st-monofasico.xml', { emit: FORN_B, itens: [{ cProd: 'C10', xProd: 'Shampoo 300ml', NCM: '33051000', CFOP: '5405', qCom: '200', vProd: '3000.00', vICMS: '0.00', vICMSST: '450.00', cstPIS: '04' }] });
// 3. aliquota zero (arroz) - nao elegivel
nfe('nf003-aliquota-zero.xml', { itens: [{ cProd: 'A1', xProd: 'Arroz tipo 1 5kg', NCM: '10063021', CFOP: '5102', qCom: '100', vProd: '2500.00', vICMS: '175.00', cstPIS: '06' }] });
// 4. fornecedor do Simples - revisar
nfe('nf004-simples.xml', { emit: FORN_SN, itens: [{ cProd: 'S1', xProd: 'Caixa de papelao', NCM: '48191000', CFOP: '5102', qCom: '300', vProd: '900.00', csosn: '102', cstPIS: '49' }] });
// 5. ativo imobilizado - nao elegivel
nfe('nf005-imobilizado.xml', { itens: [{ cProd: 'M1', xProd: 'Empilhadeira eletrica', NCM: '84271000', CFOP: '5551', qCom: '1', vProd: '85000.00', vICMS: '0.00' }] });
// 6. transferencia - nao elegivel
nfe('nf006-transferencia.xml', { emit: { cnpj: '11222333000262', nome: 'Comercial Exemplo Ltda - Filial', crt: '3' }, itens: [{ cProd: 'P100', xProd: 'Parafuso sextavado 6mm', NCM: '73181500', CFOP: '5152', qCom: '100', vProd: '200.00', vICMS: '24.00' }] });
// 7. devolucao (finNFe 4) - nao elegivel
nfe('nf007-devolucao.xml', { finNFe: '4', itens: [{ cProd: 'D1', xProd: 'Item devolvido', NCM: '73181500', CFOP: '5202', qCom: '10', vProd: '100.00', vICMS: '18.00' }] });
// 8. nota cancelada (com evento) - ignorada
const n8 = nfe('nf008-cancelada.xml', { itens: [{ cProd: 'X1', xProd: 'Item de nota cancelada', NCM: '73181500', CFOP: '5102', qCom: '10', vProd: '10000.00', vICMS: '1800.00' }] });
fs.writeFileSync(path.join(OUT, 'nf008-evento-cancelamento.xml'), `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><evento versao="1.00"><infEvento Id="ID110111${n8.ch}01"><chNFe>${n8.ch}</chNFe><tpEvento>110111</tpEvento><detEvento><descEvento>Cancelamento</descEvento></detEvento></infEvento></evento></procEventoNFe>`);
// 9. duplicata da nota 1 (mesma chave) - contada uma vez
fs.writeFileSync(path.join(OUT, 'nf001-copia.xml'), n1.xml);
// 10. importacao (nota de entrada emitida pela propria empresa, CFOP 3102)
nfe('nf010-importacao.xml', { tpNF: '0', emit: { cnpj: EMPRESA.cnpj, nome: EMPRESA.nome, crt: '3' }, dest: { cnpj: '', nome: 'Supplier Co Ltd' }, itens: [{ cProd: 'IMP1', xProd: 'Rolamento importado', NCM: '84821010', CFOP: '3102', qCom: '400', vProd: '20000.00', vII: '2000.00', vICMS: '4000.00', vPIS: '420.00', vCOFINS: '1930.00', cstPIS: '50' }] });
// 11. venda da propria empresa - ignorada
nfe('nf011-venda-propria.xml', { emit: { cnpj: EMPRESA.cnpj, nome: EMPRESA.nome, crt: '3' }, dest: { cnpj: '99888777000166', nome: 'Cliente Final SA' }, itens: [{ cProd: 'P100', xProd: 'Parafuso sextavado 6mm', NCM: '73181500', CFOP: '5102', qCom: '50', vProd: '150.00', vICMS: '27.00' }] });
// 12. recompra do mesmo produto (agrega com nf001/P100)
nfe('nf012-recompra.xml', { data: '2026-12-10', itens: [{ cProd: 'P100', xProd: 'Parafuso sextavado 6mm', NCM: '73181500', CFOP: '6102', qCom: '500', vProd: '1100.00', vICMS: '132.00' }] });
// 13. arquivo em ISO-8859-1 com acentos
nfe('nf013-latin1.xml', { latin1: true, emit: FORN_B, itens: [{ cProd: 'L1', xProd: 'Sabão em barra ação rápida', NCM: '34011190', CFOP: '5101', qCom: '120', vProd: '600.00', vICMS: '72.00' }] });

// ZIP (deflate) com as notas 2 e 13 + uma nota extra so existente no zip
function zip(arquivos, destino) {
  const locais = [], centrais = []; let off = 0;
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  for (const [nome, dados] of arquivos) {
    const comp = zlib.deflateRawSync(dados), nm = Buffer.from(nome), c = crc(dados);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(c, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(dados.length, 22); h.writeUInt16LE(nm.length, 26);
    locais.push(h, nm, comp);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(c, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(dados.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(off, 42);
    centrais.push(cd, nm); off += 30 + nm.length + comp.length;
  }
  const cdBuf = Buffer.concat(centrais), fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10); fim.writeUInt32LE(cdBuf.length, 12); fim.writeUInt32LE(off, 16);
  fs.writeFileSync(destino, Buffer.concat([...locais, cdBuf, fim]));
}
const ZDIR = OUT + '-zip'; fs.mkdirSync(ZDIR, { recursive: true });
zip([
  ['notas/nf002-st-monofasico.xml', fs.readFileSync(path.join(OUT, 'nf002-st-monofasico.xml'))],
  ['notas/nf013-latin1.xml', fs.readFileSync(path.join(OUT, 'nf013-latin1.xml'))],
  ['notas/nf001-revenda.xml', fs.readFileSync(path.join(OUT, 'nf001-revenda.xml'))]
], path.join(ZDIR, 'notas.zip'));
console.log('XMLs gerados em', OUT, '| zip em', ZDIR);
