/*
 * Credito presumido de CBS sobre o estoque de abertura (art. 381 da LC 214/2025).
 * Le XMLs de NF-e de compra (arquivos .xml e .zip), classifica cada item e calcula o credito.
 *
 * Regras adotadas (parametros editaveis na tela):
 *  - credito = 9,25% x custo de aquisicao dos bens em estoque em 1/1/2027 (inventario de 31/12/2026);
 *  - importados: PIS/Cofins-Importacao efetivamente pagos (vPIS + vCOFINS da nota de importacao);
 *  - Lucro Presumido (regime cumulativo): todo o estoque elegivel; Lucro Real (nao cumulativo): somente
 *    bens adquiridos com incidencia monofasica ou substituicao tributaria (CST PIS 04/05);
 *  - fora do credito: bens adquiridos com aliquota zero, isencao, sem incidencia ou suspensao
 *    (CST PIS 06-09), uso e consumo, ativo imobilizado, transferencias, devolucoes e remessas;
 *  - em revisao (nao somados por padrao): fornecedor do Simples Nacional e CFOP atipico;
 *  - apropriacao ate junho/2027, em 12 parcelas mensais iguais a partir do mes de apropriacao;
 *    o credito so compensa a propria CBS.
 * Sem dependencias; funciona no navegador (window.ESTOQUE) e no Node (module.exports).
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ decimal (centavos e 6 casas)
  var S = 6, U = 1000000n;
  function D(x) {
    if (x === null || x === undefined || x === '') return 0n;
    if (typeof x === 'bigint') return x;
    var s = String(x).trim(); var neg = s[0] === '-'; if (neg || s[0] === '+') s = s.slice(1);
    if (!/^\d*(\.\d*)?$/.test(s)) return 0n;
    var p = s.split('.'), i = p[0] || '0', f = (p[1] || '').slice(0, S); while (f.length < S) f += '0';
    var v = BigInt(i) * U + BigInt(f || '0'); return neg ? -v : v;
  }
  function round2(v) { var f = 10000n, q = v / f, r = v % f; if (r < 0n) r = -r; if (r > 5000n || (r === 5000n && q % 2n !== 0n)) q += v < 0n ? -1n : 1n; return q * f; }
  function mul(a, b) { return a * b / U; }
  function div(a, b) { return b === 0n ? 0n : a * U / b; }
  function toNum(v) { return Number(v) / 1e6; }
  function toStr(v, c) { var r = c === 2 ? round2(v) : v; var neg = r < 0n; if (neg) r = -r; var s = (r / U).toString() + '.' + (r % U).toString().padStart(S, '0').slice(0, c); return (neg ? '-' : '') + s; }

  // ------------------------------------------------------------------ leitura do XML (sem DOM)
  function semNs(xml) { return xml.replace(/<(\/?)[A-Za-z0-9_]+:/g, '<$1'); }
  function bloco(x, tag) {
    var re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>');
    var m = re.exec(x); return m ? m[1] : '';
  }
  function blocos(x, tag) {
    var re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'g'), out = [], m;
    while ((m = re.exec(x))) out.push(m[1]);
    return out;
  }
  function val(x, tag) { var m = new RegExp('<' + tag + '(?:\\s[^>]*)?>([^<]*)</' + tag + '>').exec(x); return m ? decodeEnt(m[1].trim()) : ''; }
  function decodeEnt(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); }); }

  /** Interpreta um XML. Retorna {tipo:'nfe'|'cancelamento'|'ignorado', ...} */
  function lerXml(texto, nomeArquivo) {
    var x = semNs(String(texto || ''));
    // evento de cancelamento
    if (/<procEventoNFe|<evento[\s>]/.test(x) && /<tpEvento>110111<\/tpEvento>/.test(x)) {
      return { tipo: 'cancelamento', chave: val(x, 'chNFe'), arquivo: nomeArquivo };
    }
    var inf = /<infNFe[^>]*Id="NFe(\d{44})"[^>]*>/.exec(x);
    if (!inf || !/<det[\s>]/.test(x)) return { tipo: 'ignorado', arquivo: nomeArquivo, motivo: 'não é uma NF-e com itens (modelo 55/65)' };
    var ide = bloco(x, 'ide'), emit = bloco(x, 'emit'), dest = bloco(x, 'dest'), prot = bloco(x, 'protNFe');
    var nota = {
      tipo: 'nfe', arquivo: nomeArquivo, chave: inf[1], modelo: val(ide, 'mod'), serie: val(ide, 'serie'), nNF: val(ide, 'nNF'),
      dhEmi: (val(ide, 'dhEmi') || val(ide, 'dEmi')).slice(0, 10), tpNF: val(ide, 'tpNF'), finNFe: val(ide, 'finNFe'),
      emit: { cnpj: val(emit, 'CNPJ') || val(emit, 'CPF'), nome: val(emit, 'xNome'), uf: val(bloco(emit, 'enderEmit'), 'UF'), crt: val(emit, 'CRT') },
      dest: { cnpj: val(dest, 'CNPJ') || val(dest, 'CPF'), nome: val(dest, 'xNome') },
      cStat: prot ? val(prot, 'cStat') : '', itens: []
    };
    blocos(x, 'det').forEach(function (det, i) {
      var prod = bloco(det, 'prod'), imp = bloco(det, 'imposto');
      var icms = bloco(imp, 'ICMS'), ipi = bloco(imp, 'IPI'), pis = bloco(imp, 'PIS'), cof = bloco(imp, 'COFINS'), ii = bloco(imp, 'II');
      nota.itens.push({
        nItem: i + 1, cProd: val(prod, 'cProd'), xProd: val(prod, 'xProd'), NCM: val(prod, 'NCM'), CFOP: val(prod, 'CFOP'),
        uCom: val(prod, 'uCom'), qCom: val(prod, 'qCom') || '1', vUnCom: val(prod, 'vUnCom'),
        vProd: val(prod, 'vProd'), vFrete: val(prod, 'vFrete'), vSeg: val(prod, 'vSeg'), vDesc: val(prod, 'vDesc'), vOutro: val(prod, 'vOutro'),
        cstICMS: val(icms, 'CST') || val(icms, 'CSOSN'), vICMS: val(icms, 'vICMS'), vICMSST: val(icms, 'vICMSST'), vFCPST: val(icms, 'vFCPST'),
        vIPI: val(ipi, 'vIPI'), cstPIS: val(pis, 'CST'), vPIS: val(pis, 'vPIS'), vCOFINS: val(cof, 'vCOFINS'), vII: val(ii, 'vII')
      });
    });
    return nota;
  }

  // ------------------------------------------------------------------ ZIP (deflate via DecompressionStream)
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  /** Lista as entradas de um .zip (Uint8Array). Retorna [{nome, ler: async () => Uint8Array}] */
  function listarZip(bytes) {
    var fim = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (u32(bytes, i) === 0x06054b50) { fim = i; break; }
    if (fim < 0) throw new Error('arquivo ZIP inválido ou corrompido');
    var n = u16(bytes, fim + 10), off = u32(bytes, fim + 16), out = [];
    var dec = new TextDecoder('utf-8');
    for (var k = 0; k < n; k++) {
      if (u32(bytes, off) !== 0x02014b50) throw new Error('diretório do ZIP inválido');
      var metodo = u16(bytes, off + 10), tamC = u32(bytes, off + 20), tamU = u32(bytes, off + 24);
      var lNome = u16(bytes, off + 28), lExtra = u16(bytes, off + 30), lCom = u16(bytes, off + 32), local = u32(bytes, off + 42);
      var nome = dec.decode(bytes.subarray(off + 46, off + 46 + lNome));
      out.push((function (metodo, tamC, local, nome, tamU) {
        return {
          nome: nome, tamanho: tamU,
          ler: function () {
            var ini = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
            var dados = bytes.subarray(ini, ini + tamC);
            if (metodo === 0) return Promise.resolve(dados);
            if (metodo !== 8) return Promise.reject(new Error('compressão não suportada em ' + nome));
            var ds = new DecompressionStream('deflate-raw');
            var stream = new Blob([dados]).stream().pipeThrough(ds);
            return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
          }
        };
      })(metodo, tamC, local, nome, tamU));
      off += 46 + lNome + lExtra + lCom;
    }
    return out;
  }
  /** Decodifica bytes de XML respeitando o encoding declarado (UTF-8 ou ISO-8859-1). */
  function decodificarXml(bytes) {
    var cab = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
    var m = /encoding=["']([^"']+)["']/i.exec(cab);
    var enc = m ? m[1].toLowerCase() : 'utf-8';
    try { return new TextDecoder(/8859|latin/.test(enc) ? 'latin1' : 'utf-8').decode(bytes); } catch (e) { return new TextDecoder('utf-8').decode(bytes); }
  }

  // ------------------------------------------------------------------ classificacao do item
  var PARAM_PADRAO = { aliquota: '9.25', regime: 'LP', excluirIcms: true, incluirIpi: true, incluirSt: true, incluirRevisar: false };

  function cfopEntrada(cfop, notaPropria) {
    cfop = String(cfop || '');
    if (cfop.length !== 4) return cfop;
    if (notaPropria) return cfop; // nota de entrada emitida pela propria empresa (1/2/3xxx)
    var map = { '5': '1', '6': '2', '7': '3' };
    return (map[cfop[0]] || cfop[0]) + cfop.slice(1);
  }
  function grupoCfop(cf) {
    var r = cf.slice(1), n = Number(r);
    var em = function (lista) { return lista.indexOf(n) >= 0; };
    var entre = function (a, b) { return n >= a && n <= b; };
    if (cf[0] === '3') return { g: 'importacao', txt: 'Importação' };
    if (entre(151, 156) || em([408, 409, 552, 557, 658, 659])) return { g: 'nao', txt: 'Transferência entre estabelecimentos' };
    if (entre(201, 210) || entre(410, 413) || em([553, 660, 661, 662])) return { g: 'nao', txt: 'Devolução' };
    if (em([551, 406])) return { g: 'nao', txt: 'Ativo imobilizado' };
    if (em([556, 407, 653])) return { g: 'nao', txt: 'Uso e consumo' };
    if (em([910, 920, 922, 932, 949])) return { g: 'revisar', txt: 'CFOP atípico (bonificação, remessa ou outras entradas)' };
    if (entre(900, 949)) return { g: 'nao', txt: 'Remessa, retorno, demonstração, conserto ou consignação' };
    if (entre(101, 126) || em([401, 402, 403, 405, 651, 652])) return { g: 'ok', txt: em([401, 403, 405]) ? 'Revenda/insumo com ICMS-ST' : 'Revenda ou insumo de produção' };
    if (entre(251, 257)) return { g: 'nao', txt: 'Energia elétrica (não é bem em estoque)' };
    return { g: 'revisar', txt: 'Finalidade não identificada pelo CFOP' };
  }

  /** Classifica um item: {situacao: 'elegivel'|'revisar'|'nao', motivo, monofasico} */
  function classificar(nota, item, regime, notaPropria) {
    var cf = cfopEntrada(item.CFOP, notaPropria), g = grupoCfop(cf);
    var cst = String(item.cstPIS || '');
    var mono = cst === '04' || cst === '05';
    var res = { cfopEntrada: cf, monofasico: mono, importacao: g.g === 'importacao' };
    if (nota.finNFe === '4') return Object.assign(res, { situacao: 'nao', motivo: 'Nota de devolução' });
    if (g.g === 'nao') return Object.assign(res, { situacao: 'nao', motivo: g.txt });
    if (['06', '07', '08', '09'].indexOf(cst) >= 0) return Object.assign(res, { situacao: 'nao', motivo: { '06': 'Adquirido com alíquota zero de PIS/Cofins', '07': 'Adquirido com isenção de PIS/Cofins', '08': 'Adquirido sem incidência de PIS/Cofins', '09': 'Adquirido com suspensão de PIS/Cofins' }[cst] });
    if (regime === 'LR' && !mono) return Object.assign(res, { situacao: 'nao', motivo: 'Lucro Real: PIS/Cofins já creditado no regime não cumulativo (só monofásico/ST gera crédito presumido)' });
    if (g.g === 'importacao') return Object.assign(res, { situacao: 'elegivel', motivo: 'Importação: crédito = PIS/Cofins-Importação pagos' });
    if (!notaPropria && (nota.emit.crt === '1' || nota.emit.crt === '2' || nota.emit.crt === '4')) return Object.assign(res, { situacao: 'revisar', motivo: 'Fornecedor do Simples Nacional (crédito sujeito a confirmação)' });
    if (g.g === 'revisar') return Object.assign(res, { situacao: 'revisar', motivo: g.txt });
    return Object.assign(res, { situacao: 'elegivel', motivo: g.txt + (mono ? ' — PIS/Cofins monofásico/ST' : '') });
  }

  function custoItem(item, p) {
    var c = D(item.vProd) - D(item.vDesc) + D(item.vFrete) + D(item.vSeg) + D(item.vOutro) + D(item.vII);
    if (p.incluirIpi) c += D(item.vIPI);
    if (p.incluirSt) c += D(item.vICMSST) + D(item.vFCPST);
    if (p.excluirIcms) c -= D(item.vICMS);
    return c < 0n ? 0n : c;
  }

  // ------------------------------------------------------------------ processamento do lote
  /**
   * Consolida as notas lidas.
   * notas: [resultado de lerXml]; p: parametros; cnpjEmpresa: opcional (detectado se vazio)
   * Retorna {cnpjEmpresa, nomeEmpresa, produtos:[...], notas:{...}, avisos:[...], ignoradas:[...]}
   */
  function consolidar(lidas, p, cnpjEmpresa) {
    p = Object.assign({}, PARAM_PADRAO, p || {});
    var canceladas = {}, ignoradas = [], porChave = {}, dup = 0;
    lidas.forEach(function (n) {
      if (n.tipo === 'cancelamento') { if (n.chave) canceladas[n.chave] = true; return; }
      if (n.tipo !== 'nfe') { ignoradas.push({ arquivo: n.arquivo, motivo: n.motivo || 'arquivo não reconhecido' }); return; }
      if (porChave[n.chave]) { dup++; return; }
      porChave[n.chave] = n;
    });
    var notas = Object.keys(porChave).map(function (k) { return porChave[k]; });
    // empresa = CNPJ mais frequente como destinatario de saidas de terceiros ou emitente de entradas proprias
    var cont = {}, nomes = {};
    if (!cnpjEmpresa) {
      notas.forEach(function (n) {
        var c = n.tpNF === '0' ? n.emit.cnpj : n.dest.cnpj, nm = n.tpNF === '0' ? n.emit.nome : n.dest.nome;
        if (c) { cont[c] = (cont[c] || 0) + 1; nomes[c] = nm; }
      });
      cnpjEmpresa = Object.keys(cont).sort(function (a, b) { return cont[b] - cont[a]; })[0] || '';
    }
    cnpjEmpresa = String(cnpjEmpresa).replace(/\D/g, '');
    var nomeEmpresa = nomes[cnpjEmpresa] || '';
    var produtos = {}, resumo = { notasValidas: 0, canceladas: 0, naoAutorizadas: 0, deOutroDestinatario: 0, saidasProprias: 0, duplicadas: dup };
    notas.forEach(function (n) {
      if (canceladas[n.chave] || n.cStat === '101' || n.cStat === '151' || n.cStat === '135') { resumo.canceladas++; return; }
      if (n.cStat && ['100', '150'].indexOf(n.cStat) < 0) { resumo.naoAutorizadas++; ignoradas.push({ arquivo: n.arquivo, motivo: 'NF-e não autorizada (cStat ' + n.cStat + ')' }); return; }
      var propria = n.emit.cnpj === cnpjEmpresa;
      if (propria && n.tpNF === '1') { resumo.saidasProprias++; return; }               // venda da propria empresa
      if (!propria && n.dest.cnpj !== cnpjEmpresa) { resumo.deOutroDestinatario++; ignoradas.push({ arquivo: n.arquivo, motivo: 'Destinatário diferente da empresa (' + n.dest.cnpj + ')' }); return; }
      if (!propria && n.tpNF === '0') { resumo.deOutroDestinatario++; return; }         // entrada emitida por terceiro
      if (!nomeEmpresa) nomeEmpresa = propria ? n.emit.nome : n.dest.nome;
      resumo.notasValidas++;
      n.itens.forEach(function (it) {
        var cl = classificar(n, it, p.regime, propria);
        var chave = (propria ? 'IMP' : n.emit.cnpj) + '|' + it.cProd + '|' + it.NCM + '|' + (it.uCom || '').toUpperCase();
        var pr = produtos[chave];
        if (!pr) {
          pr = produtos[chave] = { id: chave, cProd: it.cProd, xProd: it.xProd, NCM: it.NCM, uCom: it.uCom, fornecedor: propria ? 'Importação / nota própria' : n.emit.nome, cnpjFornecedor: propria ? '' : n.emit.cnpj,
            cfops: {}, notas: [], qCompra: 0n, custo: 0n, pisCofinsImp: 0n, situacao: cl.situacao, motivo: cl.motivo, monofasico: cl.monofasico, importacao: cl.importacao, ultimaData: '' };
        }
        // a pior situacao prevalece (nao > revisar > elegivel)
        var ordem = { elegivel: 0, revisar: 1, nao: 2 };
        if (ordem[cl.situacao] > ordem[pr.situacao]) { pr.situacao = cl.situacao; pr.motivo = cl.motivo; }
        pr.cfops[cl.cfopEntrada] = true;
        pr.notas.push(n.nNF);
        pr.qCompra += D(it.qCom);
        pr.custo += custoItem(it, p);
        pr.pisCofinsImp += D(it.vPIS) + D(it.vCOFINS);
        if (n.dhEmi > pr.ultimaData) pr.ultimaData = n.dhEmi;
      });
    });
    var lista = Object.keys(produtos).map(function (k) {
      var pr = produtos[k];
      pr.cfops = Object.keys(pr.cfops).join(', ');
      pr.notas = pr.notas.filter(function (v, i, a) { return a.indexOf(v) === i; });
      pr.custoUnit = pr.qCompra > 0n ? div(pr.custo, pr.qCompra) : pr.custo;
      pr.qEstoque = pr.qCompra; // padrao: tudo o que foi comprado ainda esta em estoque
      pr.incluir = pr.situacao === 'elegivel' || (pr.situacao === 'revisar' && p.incluirRevisar);
      return pr;
    }).sort(function (a, b) { return (a.situacao > b.situacao ? 1 : a.situacao < b.situacao ? -1 : 0) || (b.custo > a.custo ? 1 : -1); });
    return { cnpjEmpresa: cnpjEmpresa, nomeEmpresa: nomeEmpresa, produtos: lista, resumo: resumo, ignoradas: ignoradas, param: p };
  }

  /** Valor do estoque e credito de um produto, considerando a quantidade em estoque informada. */
  function creditoProduto(pr, p) {
    p = Object.assign({}, PARAM_PADRAO, p || {});
    var q = D(pr.qEstoque), qc = pr.qCompra;
    var fr = qc > 0n ? (q > qc ? U : div(q, qc)) : (q > 0n ? U : 0n);   // fracao do comprado ainda em estoque (max 100%)
    var valorEstoque = round2(mul(pr.custo, fr));
    var credito;
    if (pr.importacao) credito = round2(mul(pr.pisCofinsImp, fr));
    else credito = round2(div(mul(valorEstoque, D(p.aliquota)), 100n * U));
    return { valorEstoque: valorEstoque, credito: credito, fracao: fr };
  }

  /** Totais do lote: {base, credito, porSituacao, outros} */
  function totalizar(produtos, p, outrosValor) {
    p = Object.assign({}, PARAM_PADRAO, p || {});
    var t = { base: 0n, credito: 0n, baseImp: 0n, creditoImp: 0n, potencialRevisar: 0n, nao: 0n, itensIncluidos: 0 };
    produtos.forEach(function (pr) {
      var c = creditoProduto(pr, p);
      pr._calc = c;
      if (pr.situacao === 'nao') { t.nao += c.valorEstoque; return; }
      if (pr.situacao === 'revisar' && !pr.incluir) { t.potencialRevisar += c.credito; return; }
      if (!pr.incluir) return;
      t.itensIncluidos++;
      if (pr.importacao) { t.baseImp += c.valorEstoque; t.creditoImp += c.credito; }
      else t.base += c.valorEstoque;
      t.credito += c.credito;
    });
    var outros = D(outrosValor);
    t.outrosBase = round2(outros);
    t.outrosCredito = round2(div(mul(outros, D(p.aliquota)), 100n * U));
    t.base += t.outrosBase; t.credito += t.outrosCredito;
    return t;
  }

  /** Cronograma: 12 parcelas iguais a partir do mes de apropriacao (1..6 de 2027). */
  function cronograma(credito, mesInicio, ano) {
    ano = ano || 2027; var n = 12, out = [];
    var parc = round2(credito / BigInt(n));
    var acum = 0n;
    for (var i = 0; i < n; i++) {
      var v = i === n - 1 ? credito - acum : parc;
      acum += v;
      var m = mesInicio - 1 + i, a = ano + Math.floor(m / 12);
      out.push({ n: i + 1, mes: (m % 12) + 1, ano: a, valor: v, saldo: credito - acum });
    }
    return out;
  }

  var API = { lerXml: lerXml, listarZip: listarZip, decodificarXml: decodificarXml, consolidar: consolidar, classificar: classificar,
    cfopEntrada: cfopEntrada, custoItem: custoItem, creditoProduto: creditoProduto, totalizar: totalizar, cronograma: cronograma,
    D: D, toStr: toStr, toNum: toNum, round2: round2, PARAM_PADRAO: PARAM_PADRAO };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.ESTOQUE = API;
})(typeof window !== 'undefined' ? window : globalThis);
