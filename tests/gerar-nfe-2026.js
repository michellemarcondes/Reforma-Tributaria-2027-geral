// Gera XMLs de NF-e de 2026 para testar o simulador de nota a partir do XML.
// Uso: node tests/gerar-nfe-2026.js <pasta_saida>
const fs = require('fs'), path = require('path');
const OUT = process.argv[2] || 'nfe-2026'; fs.mkdirSync(OUT, { recursive: true });
const chave = n => ('3526111122233300018155001' + String(n).padStart(9, '0') + '1' + '00000000').slice(0, 43) + '7';
const prod = (o) => `<prod><cProd>${o.cod}</cProd><cEAN>SEM GTIN</cEAN><xProd>${o.desc}</xProd><NCM>${o.ncm}</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>${o.q}.0000</qCom><vUnCom>${(o.vProd / o.q).toFixed(10)}</vUnCom><vProd>${o.vProd.toFixed(2)}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>${o.q}.0000</qTrib><vUnTrib>${(o.vProd / o.q).toFixed(10)}</vUnTrib>${o.frete ? `<vFrete>${o.frete.toFixed(2)}</vFrete>` : ''}${o.desc2 ? `<vDesc>${o.desc2.toFixed(2)}</vDesc>` : ''}<indTot>1</indTot></prod>`;
function nfe(n, emit, dets, vNF) {
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave(n)}" versao="4.00">` +
    `<ide><cUF>35</cUF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod><serie>1</serie><nNF>${n}</nNF><dhEmi>2026-11-20T10:00:00-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><indFinal>0</indFinal></ide>` +
    `<emit><CNPJ>11222333000181</CNPJ><xNome>${emit.nome}</xNome><enderEmit><xMun>SAO PAULO</xMun><UF>SP</UF></enderEmit><CRT>${emit.crt}</CRT></emit>` +
    `<dest><CNPJ>44555666000199</CNPJ><xNome>CLIENTE TESTE LTDA</xNome><enderDest><xMun>CAMPINAS</xMun><UF>SP</UF></enderDest></dest>` +
    dets.map((d, i) => `<det nItem="${i + 1}">${d}</det>`).join('') +
    `<total><ICMSTot><vNF>${vNF.toFixed(2)}</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
}
// Lucro Presumido, SP: notebook (integral, ICMS 18%, IPI 10%, PIS/Cofins 0,65% + 3% sem ICMS na base),
// arroz (cesta básica: CBS/IBS zero; ICMS 18% com redução de base de 61,11%; PIS/Cofins alíquota zero),
// medicamento (redução de 60%; ICMS 18% + ST; PIS/Cofins monofásico na revenda)
const d1 = prod({ cod: 'NB-01', desc: 'NOTEBOOK 15 POL', ncm: '84713012', q: 1, vProd: 1000 }) +
  `<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>1000.00</vBC><pICMS>18.00</pICMS><vICMS>180.00</vICMS></ICMS00></ICMS>` +
  `<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>1000.00</vBC><pIPI>10.00</pIPI><vIPI>100.00</vIPI></IPITrib></IPI>` +
  `<PIS><PISAliq><CST>01</CST><vBC>820.00</vBC><pPIS>0.65</pPIS><vPIS>5.33</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vBC>820.00</vBC><pCOFINS>3.00</pCOFINS><vCOFINS>24.60</vCOFINS></COFINSAliq></COFINS>` +
  `<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>820.00</vBC></gIBSCBS></IBSCBS></imposto>`;
const d2 = prod({ cod: 'AR-05', desc: 'ARROZ BRANCO TIPO 1 5KG', ncm: '10063021', q: 20, vProd: 500 }) +
  `<imposto><ICMS><ICMS20><orig>0</orig><CST>20</CST><modBC>3</modBC><pRedBC>61.11</pRedBC><vBC>194.45</vBC><pICMS>18.00</pICMS><vICMS>35.00</vICMS></ICMS20></ICMS>` +
  `<PIS><PISNT><CST>06</CST></PISNT></PIS><COFINS><COFINSNT><CST>06</CST></COFINSNT></COFINS></imposto>`;
const d3 = prod({ cod: 'MD-10', desc: 'MEDICAMENTO GENERICO CX', ncm: '30049099', q: 10, vProd: 300, frete: 10, desc2: 20 }) +
  `<imposto><ICMS><ICMS10><orig>0</orig><CST>10</CST><modBC>3</modBC><vBC>290.00</vBC><pICMS>18.00</pICMS><vICMS>52.20</vICMS><modBCST>4</modBCST><vBCST>456.67</vBCST><pICMSST>18.00</pICMSST><vICMSST>30.00</vICMSST></ICMS10></ICMS>` +
  `<PIS><PISNT><CST>04</CST></PISNT></PIS><COFINS><COFINSNT><CST>04</CST></COFINSNT></COFINS></imposto>`;
fs.writeFileSync(path.join(OUT, 'nfe-lucro-presumido.xml'), nfe(101, { nome: 'COMERCIAL TESTE LTDA', crt: 3 }, [d1, d2, d3], 1920));
// Simples Nacional: sem ICMS/PIS/Cofins destacados
const ds = prod({ cod: 'CM-01', desc: 'CAMISETA ALGODAO', ncm: '61091000', q: 10, vProd: 1000 }) +
  `<imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS><PIS><PISOutr><CST>99</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS><COFINS><COFINSOutr><CST>99</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS></imposto>`;
fs.writeFileSync(path.join(OUT, 'nfe-simples.xml'), nfe(202, { nome: 'CONFECCOES SIMPLES ME', crt: 1 }, [ds], 1000));
console.log('XMLs gerados em', OUT);
