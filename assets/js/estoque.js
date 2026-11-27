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

  // ------------------------------------------------------------------ projecao com EFD (entradas, saidas e Bloco H)
  function fnum(v) { if (v === undefined || v === null || v === '') return 0; var x = Number(String(v).replace(',', '.')); return isFinite(x) ? x : 0; }
  function mesSped(dt) { return dt && dt.length === 8 ? dt.slice(4, 8) + '-' + dt.slice(2, 4) : ''; }
  function proxMes(m) { var a = Number(m.slice(0, 4)), x = Number(m.slice(5, 7)) + 1; if (x > 12) { x = 1; a++; } return a + '-' + String(x).padStart(2, '0'); }
  function ehVenda(cfop) { var c = String(cfop), r = Number(c.slice(1)); return c[0] >= '5' && ((r >= 101 && r <= 125) || (r >= 401 && r <= 405) || (r >= 651 && r <= 667)); }

  /**
   * Le uma EFD ICMS/IPI ou EFD Contribuicoes e extrai o movimento de estoque por item:
   * entradas (C170 de C100 de entrada, com CFOP, CST do PIS, ICMS, IPI, ICMS-ST e rateio de frete/seguro/outras),
   * saidas (C170 de venda com quantidade; C180 da NFC-e por valor) e inventario (H005/H010, so na EFD ICMS/IPI).
   */
  function lerEfdMov(texto) {
    var tipo = /\n\|0110\|/.test(texto.slice(0, 20000)) ? 'contrib' : 'icms';
    var o = { tipo: tipo, mes: '', cnpj: '', nome: '', itens: {}, part: {}, entradas: [], saidas: {}, inventario: null };
    var doc = null, valido = true, entrada = false;
    var fecharDoc = function () {
      if (!doc || !doc.linhas.length) return;
      var soma = doc.linhas.reduce(function (a, l) { return a + l.vProd; }, 0) || 1;
      doc.linhas.forEach(function (l) { l.acessorios = doc.acess * l.vProd / soma; o.entradas.push(l); });
    };
    texto.split(/\r?\n/).forEach(function (ln) {
      if (ln.charAt(0) !== '|') return;
      var f = ln.split('|'), reg = f[1];
      switch (reg) {
        case '0000':
          if (tipo === 'icms') { o.mes = mesSped(f[4]); o.nome = f[6]; o.cnpj = f[7]; }
          else { o.mes = mesSped(f[7]); o.nome = f[8]; o.cnpj = f[9]; }
          break;
        case '0150': o.part[f[2]] = f[5] || f[6]; break;
        case '0200': o.itens[f[2]] = { desc: f[3], unid: f[6], tipo: f[7], ncm: f[8] }; break;
        case 'C100':
          fecharDoc(); doc = null;
          valido = ['02', '03', '04', '05'].indexOf(f[6]) < 0; entrada = f[2] === '0';
          if (valido && entrada) doc = { chave: f[9], forn: o.part[f[4]] || '', acess: fnum(f[18]) + fnum(f[19]) + fnum(f[20]), linhas: [] };
          break;
        case 'C170':
          if (!valido) break;
          var cod = f[3], q = fnum(f[5]), v = fnum(f[7]) - fnum(f[8]);
          if (entrada && doc) {
            doc.linhas.push({ mes: o.mes, cod: cod, nItem: f[2], chave: doc.chave, forn: doc.forn, qtd: q, vProd: v, cfop: f[11], vICMS: fnum(f[15]), vICMSST: fnum(f[18]), vIPI: fnum(f[24]), cstPIS: f[25], vPIS: fnum(f[30]), vCOFINS: fnum(f[36]) });
          } else if (!entrada && ehVenda(f[11])) {
            var s = o.saidas[cod] = o.saidas[cod] || { qtd: 0, valor: 0, valorComQtd: 0, valorSemQtd: 0 };
            s.qtd += q; s.valor += v; s.valorComQtd += v;
          }
          break;
        case 'C180':   // NFC-e consolidada por item (EFD Contribuicoes): so valor
          fecharDoc(); doc = null;
          var s2 = o.saidas[f[5]] = o.saidas[f[5]] || { qtd: 0, valor: 0, valorComQtd: 0, valorSemQtd: 0 };
          s2.valor += fnum(f[8]); s2.valorSemQtd += fnum(f[8]);
          if (!o.itens[f[5]] && f[6]) o.itens[f[5]] = { desc: '', unid: '', tipo: '', ncm: f[6] };
          break;
        case 'H005': fecharDoc(); doc = null; o.inventario = { data: f[2], mesRef: mesSped(f[2]), valor: fnum(f[3]), motivo: f[4], itens: [] }; break;
        case 'H010':
          if (o.inventario && f[7] !== '2') o.inventario.itens.push({ cod: f[2], qtd: fnum(f[4]), valor: fnum(f[6]) });   // IND_PROP 2 = de terceiros
          break;
        default:
          if (/^[A-Z]\d{3}$/.test(reg) && reg !== 'C170' && reg !== 'C190' && reg.charAt(0) !== 'C') { fecharDoc(); doc = null; }
      }
    });
    fecharDoc();
    return o;
  }

  var GRUPOS = ['elegivel', 'importacao', 'revisar', 'nao'];
  /** Grupo de credito de uma linha de entrada da EFD (usa as mesmas regras dos XMLs). */
  function grupoEntradaEfd(l, item, regime, crtFornecedor) {
    var tp = String((item || {}).tipo || '');
    if (tp === '07') return { g: 'nao', motivo: 'Uso e consumo (tipo do item 07)' };
    if (tp === '08') return { g: 'nao', motivo: 'Ativo imobilizado (tipo do item 08)' };
    if (tp === '09') return { g: 'nao', motivo: 'Serviço (tipo do item 09)' };
    var c = classificar({ finNFe: '', emit: { crt: crtFornecedor || '' } }, { CFOP: l.cfop, cstPIS: l.cstPIS }, regime, true);
    if (c.situacao === 'elegivel' && !c.importacao && (crtFornecedor === '1' || crtFornecedor === '2' || crtFornecedor === '4')) return { g: 'revisar', motivo: 'Fornecedor do Simples Nacional (XML da nota)' };
    if (c.situacao === 'nao') return { g: 'nao', motivo: c.motivo };
    if (c.situacao === 'revisar') return { g: 'revisar', motivo: c.motivo };
    if (tp === '03' || tp === '04' || tp === '05') return { g: 'revisar', motivo: 'Produto em processo/acabado: o crédito alcança os insumos adquiridos' };
    return { g: c.importacao ? 'importacao' : 'elegivel', motivo: c.motivo };
  }

  /**
   * Projeta o estoque de 31/12/2026 a partir do movimento das EFD (pseudo-inventario).
   * Ponto de partida padrao ('calculado'): estoque zero (ou o estoque inicial informado) no inicio do primeiro mes
   * enviado; o saldo de cada item e acumulado mes a mes com as entradas a custo menos as saidas a custo
   * (nunca abaixo de zero por item). Exige no minimo 2 meses de EFD e media de no minimo 2 meses-base.
   * Outras partidas opcionais: 'bloco-h' (H010), 'xml' (estoque dos XMLs) ou 'informado' (fim do ultimo mes).
   * opts: { regime, excluirIcms, incluirIpi, incluirSt, aliquota, mesesBase (>= 2), inicio, estoqueInicial (R$, no inicio
   *         do periodo), estoqueXml {g: valor}, estoqueInformado (R$), margemBruta, crtPorChave, crtPorCnpj, fim: '2026-12' }
   */
  function projetarEstoque(movs, opts) {
    opts = Object.assign({ regime: 'LP', excluirIcms: true, incluirIpi: true, incluirSt: true, aliquota: '9.25', mesesBase: 2, inicio: 'calculado', fim: '2026-12' }, opts || {});
    var avisos = [], itens = {}, inv = null, meses = {};
    var item = function (k) { return itens[k] = itens[k] || { cod: k, desc: '', ncm: '', tipo: '', entQtd: 0, entCusto: 0, grupos: {}, motivo: '', ent: {}, sai: {}, impPisCof: 0 }; };
    // 1) cadastro e inventario (opcional)
    movs.forEach(function (m) {
      if (m.mes) meses[m.mes] = 1;
      Object.keys(m.itens).forEach(function (k) { var it = item(k), c = m.itens[k]; if (!it.ncm && c.ncm) it.ncm = c.ncm; if (!it.desc && c.desc) it.desc = c.desc; if (!it.tipo && c.tipo) it.tipo = c.tipo; });
      if (m.inventario && (!inv || m.inventario.data > inv.data)) inv = m.inventario;
    });
    var listaMeses = Object.keys(meses).filter(Boolean).sort();
    if (listaMeses.length < 2) return { erro: 'Envie pelo menos 2 meses de EFD (ICMS/IPI e Contribuições): o pseudo-inventário é calculado pelas entradas e saídas de no mínimo 2 meses.' };
    // 2) entradas a custo por item e mes (EFD ICMS tem prioridade sobre a Contribuicoes no mesmo mes)
    movs.forEach(function (m) {
      if (m.tipo !== 'icms' && movs.some(function (x) { return x.tipo === 'icms' && x.mes === m.mes; })) return;
      m.entradas.forEach(function (l) {
        var it = item(l.cod), crt = (opts.crtPorChave || {})[l.chave] || (opts.crtPorCnpj || {})[l.forn];
        var cl = grupoEntradaEfd(l, it, opts.regime, crt);
        var custo = l.vProd + l.acessorios - (opts.excluirIcms ? l.vICMS : 0) + (opts.incluirIpi ? l.vIPI : 0) + (opts.incluirSt ? l.vICMSST : 0);
        if (custo < 0) custo = 0;
        it.ent[l.mes] = (it.ent[l.mes] || 0) + custo;
        it.entQtd += l.qtd; it.entCusto += custo; it.grupos[cl.g] = (it.grupos[cl.g] || 0) + custo; if (!it.motivo || cl.g !== 'elegivel') it.motivo = cl.motivo;
        if (cl.g === 'importacao') it.impPisCof += l.vPIS + l.vCOFINS;
      });
    });
    // 3) custo medio e grupo de cada item
    var usarH = opts.inicio === 'bloco-h' && inv;
    var invItens = {}; if (usarH) inv.itens.forEach(function (h) { invItens[h.cod] = h; });
    Object.keys(itens).forEach(function (k) {
      var it = itens[k], h = invItens[k];
      var qt = it.entQtd + (h ? h.qtd : 0), vt = it.entCusto + (h ? h.valor : 0);
      it.custoMedio = qt > 0 ? vt / qt : 0;
      var gs = Object.keys(it.grupos).sort(function (a, b) { return it.grupos[b] - it.grupos[a]; });
      if (gs.length) it.grupo = gs[0];
      else {
        var tp = String(it.tipo || '');
        it.grupo = tp === '07' || tp === '08' || tp === '09' ? 'nao' : (tp === '03' || tp === '04' || tp === '05' ? 'revisar' : (opts.regime === 'LR' ? 'nao' : 'elegivel'));
        it.motivo = tp === '07' ? 'Uso e consumo (tipo do item 07)' : tp === '08' ? 'Ativo imobilizado (tipo do item 08)' : 'Sem entrada no período: classificado pelo tipo do item';
      }
    });
    // 4) saidas a custo por item e mes (usa, por mes, a EFD com mais informacao de saida)
    var saiMes = {};
    movs.forEach(function (m) {
      var q = Object.keys(m.saidas).reduce(function (a, k) { return a + m.saidas[k].qtd + m.saidas[k].valor; }, 0);
      if (!saiMes[m.mes] || q > saiMes[m.mes].q) saiMes[m.mes] = { q: q, saidas: m.saidas };
    });
    var custoV = 0, precoV = 0;
    Object.keys(saiMes).forEach(function (mm) { var sm = saiMes[mm].saidas; Object.keys(sm).forEach(function (k) { var it = itens[k]; if (it && it.custoMedio && sm[k].qtd) { custoV += sm[k].qtd * it.custoMedio; precoV += sm[k].valorComQtd; } }); });
    var ratioGlobal = precoV ? custoV / precoV : null, foraPeriodo = 0, porMargem = 0;
    Object.keys(saiMes).forEach(function (mm) {
      var sm = saiMes[mm].saidas;
      Object.keys(sm).forEach(function (k) {
        var s = sm[k], it = item(k);
        if (!it.custoMedio) { foraPeriodo += s.valor; return; }       // vendido sem compra no periodo: estoque anterior
        var precoUnit = s.qtd ? s.valorComQtd / s.qtd : 0, custo = s.qtd * it.custoMedio;
        if (s.valorSemQtd) {
          var r = precoUnit ? it.custoMedio / precoUnit : ratioGlobal;
          if (r === null) { r = 1 - fnum(opts.margemBruta === undefined ? 30 : opts.margemBruta) / 100; porMargem += s.valorSemQtd; }
          custo += s.valorSemQtd * r;
        }
        it.sai[mm] = (it.sai[mm] || 0) + custo;
      });
    });
    if (foraPeriodo > 0) avisos.push('Vendas de R$ ' + foraPeriodo.toFixed(2).replace('.', ',') + ' são de itens sem compra nos meses enviados (estoque anterior ao período) e não entram no pseudo-inventário. Envie mais meses de EFD para incluí-los.');
    if (porMargem > 0) avisos.push('R$ ' + porMargem.toFixed(2).replace('.', ',') + ' em vendas sem quantidade (NFC-e consolidada) foram convertidos a custo pela margem bruta informada.');
    listaMeses.forEach(function (mm) {
      var temSai = Object.keys(itens).some(function (k) { return itens[k].sai[mm]; }), temEnt = Object.keys(itens).some(function (k) { return itens[k].ent[mm]; });
      if (temEnt && !temSai && !saiMes[mm]) avisos.push('Sem saídas identificadas em ' + mm.split('-').reverse().join('/') + ' (envie a EFD Contribuições com os itens vendidos — C170/C180): o estoque desse mês pode estar superestimado.');
      else if (temEnt && !temSai) avisos.push('Sem saídas identificadas em ' + mm.split('-').reverse().join('/') + ': o estoque desse mês pode estar superestimado.');
    });
    // 5) medias dos meses-base (minimo 2)
    var nb = Math.max(2, Math.min(listaMeses.length, Number(opts.mesesBase) || 2));
    var base = listaMeses.slice(-nb);
    Object.keys(itens).forEach(function (k) {
      var it = itens[k];
      it.mediaEnt = base.reduce(function (a, m) { return a + (it.ent[m] || 0); }, 0) / nb;
      it.mediaSai = base.reduce(function (a, m) { return a + (it.sai[m] || 0); }, 0) / nb;
    });
    // 6) meses a percorrer
    var ultimo = listaMeses[listaMeses.length - 1], primeiro = listaMeses[0];
    var inicio = opts.inicio === 'bloco-h' && !inv ? 'calculado' : opts.inicio;
    if (opts.inicio === 'bloco-h' && !inv) avisos.push('Nenhum inventário (Bloco H) nas EFD enviadas: usado o pseudo-inventário calculado pelas entradas e saídas.');
    var vazioG = function () { var x = {}; GRUPOS.forEach(function (g) { x[g] = 0; }); return x; };
    var linhas = [], saldoInicial = vazioG(), saldoItem = {}, mesInicio;
    if (inicio === 'calculado' || inicio === 'bloco-h') {
      mesInicio = inicio === 'bloco-h' ? proxMes(inv.mesRef) : primeiro;
      if (inicio === 'bloco-h') inv.itens.forEach(function (h) { var it = item(h.cod); saldoItem[h.cod] = h.valor; saldoInicial[it.grupo || 'elegivel'] += h.valor; });
      var ei = fnum(opts.estoqueInicial);
      if (inicio === 'calculado' && ei > 0) { saldoItem.__inicial = ei; saldoInicial.elegivel += ei; }
      for (var m = mesInicio; m <= opts.fim; m = proxMes(m)) {
        var tipo = meses[m] ? 'real' : (m <= ultimo ? 'media' : 'projecao');
        if (tipo === 'media') avisos.push('Falta a EFD de ' + m.split('-').reverse().join('/') + ': o mês foi preenchido com a média dos meses-base.');
        var lin = { mes: m, tipo: tipo, grupos: {} }; GRUPOS.forEach(function (g) { lin.grupos[g] = { ini: 0, ent: 0, sai: 0, fim: 0 }; });
        Object.keys(itens).forEach(function (k) {
          var it = itens[k], g = it.grupo || 'elegivel', ini = saldoItem[k] || 0;
          var ent = tipo === 'real' ? (it.ent[m] || 0) : it.mediaEnt, sai = tipo === 'real' ? (it.sai[m] || 0) : it.mediaSai;
          if (!ini && !ent && !sai) return;
          var fim = Math.max(0, ini + ent - sai);
          var x = lin.grupos[g]; x.ini += ini; x.ent += ent; x.sai += Math.min(sai, ini + ent); x.fim += fim;
          saldoItem[k] = fim;
        });
        if (saldoItem.__inicial) { lin.grupos.elegivel.ini += saldoItem.__inicial; lin.grupos.elegivel.fim += saldoItem.__inicial; }
        linhas.push(lin);
      }
    } else {
      // partida de grupo (XMLs ou valor informado) no fim do ultimo mes enviado; projeta pelas medias dos itens
      if (inicio === 'xml') GRUPOS.forEach(function (g) { saldoInicial[g] = fnum((opts.estoqueXml || {})[g]); });
      else saldoInicial.elegivel = fnum(opts.estoqueInformado);
      var med = vazioG(), meds = vazioG();
      Object.keys(itens).forEach(function (k) { var it = itens[k]; med[it.grupo || 'elegivel'] += it.mediaEnt; meds[it.grupo || 'elegivel'] += it.mediaSai; });
      var sg = Object.assign({}, saldoInicial);
      mesInicio = proxMes(ultimo);
      for (var p = mesInicio; p <= opts.fim; p = proxMes(p)) {
        var ln = { mes: p, tipo: 'projecao', grupos: {} };
        GRUPOS.forEach(function (g) { var ini = sg[g], fim = Math.max(0, ini + med[g] - meds[g]); ln.grupos[g] = { ini: ini, ent: med[g], sai: meds[g], fim: fim }; sg[g] = fim; });
        linhas.push(ln);
      }
    }
    if (!linhas.some(function (l) { return l.tipo === 'projecao'; })) avisos.push('Os arquivos já cobrem dezembro de 2026: o estoque final é o apurado pelas EFD.');
    // 7) totais, medias por grupo e credito
    var final = vazioG(), media = {};
    GRUPOS.forEach(function (g) { media[g] = { ent: 0, sai: 0 }; });
    Object.keys(itens).forEach(function (k) { var it = itens[k], g = it.grupo || 'elegivel'; media[g].ent += it.mediaEnt; media[g].sai += it.mediaSai; });
    var ult = linhas[linhas.length - 1];
    if (ult) GRUPOS.forEach(function (g) { final[g] = ult.grupos[g].fim; });
    var aliq = fnum(opts.aliquota) / 100;
    var impCusto = 0, impPis = 0; Object.keys(itens).forEach(function (k) { if (itens[k].grupo === 'importacao') { impCusto += itens[k].entCusto; impPis += itens[k].impPisCof; } });
    var ratioImp = impCusto ? impPis / impCusto : 0;
    var credito = Math.round((final.elegivel * aliq + final.importacao * ratioImp) * 100) / 100;
    var listaItens = Object.keys(itens).map(function (k) { var it = itens[k]; it.saldoFinal = saldoItem[k] || 0; return it; }).filter(function (it) { return it.entCusto || invItens[it.cod] || Object.keys(it.sai).length; });
    return { inicio: inicio, inventario: inv ? { data: inv.data, valor: inv.valor, itens: inv.itens.length } : null, mesInicio: mesInicio, primeiroMesArquivo: primeiro, ultimoMesArquivo: ultimo,
      mesesArquivos: listaMeses, mesesBase: base, media: media, saldoInicial: saldoInicial, linhas: linhas, final: final, credito: credito, ratioImportacao: ratioImp,
      potencialRevisar: Math.round(final.revisar * aliq * 100) / 100, itens: listaItens, avisos: avisos, ratioCustoPreco: ratioGlobal, vendasForaPeriodo: foraPeriodo };
  }

  var API = { lerEfdMov: lerEfdMov, projetarEstoque: projetarEstoque, grupoEntradaEfd: grupoEntradaEfd, GRUPOS: GRUPOS, lerXml: lerXml, listarZip: listarZip, decodificarXml: decodificarXml, consolidar: consolidar, classificar: classificar,
    cfopEntrada: cfopEntrada, custoItem: custoItem, creditoProduto: creditoProduto, totalizar: totalizar, cronograma: cronograma,
    D: D, toStr: toStr, toNum: toNum, round2: round2, PARAM_PADRAO: PARAM_PADRAO };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.ESTOQUE = API;
})(typeof window !== 'undefined' ? window : globalThis);
