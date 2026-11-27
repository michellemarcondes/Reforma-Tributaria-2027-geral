/*
 * Simulador de nota a partir do XML de uma NF-e de 2026.
 * 1) "Desembute" os tributos de hoje: do preço de cada item retira o ICMS (+FCP) destacado e o PIS/Cofins
 *    pelas alíquotas da empresa; IPI e ICMS-ST são cobrados por fora e também saem do total cobrado.
 *    O resultado é o VALOR LÍQUIDO — o que a empresa efetivamente recebe pelo produto.
 * 2) A partir do valor líquido, recalcula a nota em 2027: CBS e IBS por fora (base sem ICMS, LC 214/2025,
 *    art. 12, § 2º) e ICMS por dentro, em dois cenários: CBS/IBS compondo ou não a base do ICMS.
 * Funciona no navegador (window.NOTAXML) e no Node (module.exports). Usa o motor RTC (engine.js).
 */
(function (root) {
  'use strict';
  var RTC = typeof module !== 'undefined' && module.exports ? require('./engine.js') : root.RTC;

  // ---------------------------------------------------------------- leitura do XML
  function semNs(x) { return x.replace(/<(\/?)[A-Za-z0-9_]+:/g, '<$1'); }
  function bloco(x, tag) {
    if (!x) return '';
    var re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>'), m = re.exec(x);
    return m ? m[1] : '';
  }
  function blocos(x, tag) {
    var re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'g'), out = [], m;
    while ((m = re.exec(x))) out.push(m[1]);
    return out;
  }
  function val(x, tag) { if (!x) return ''; var m = new RegExp('<' + tag + '>([^<]*)</' + tag + '>').exec(x); return m ? m[1].trim() : ''; }
  function n(s) { var v = Number(String(s || '').replace(',', '.')); return isFinite(v) ? v : 0; }
  function r2(v) { return Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }

  function ler(texto) {
    var x = semNs(String(texto || ''));
    var inf = /<infNFe[^>]*Id="NFe(\d{44})"/.exec(x);
    if (!inf || !/<det[\s>]/.test(x)) return { erro: 'O arquivo não é o XML de uma NF-e/NFC-e com itens.' };
    var ide = bloco(x, 'ide'), emit = bloco(x, 'emit'), dest = bloco(x, 'dest'), tot = bloco(bloco(x, 'total'), 'ICMSTot');
    var nota = {
      chave: inf[1], modelo: val(ide, 'mod'), serie: val(ide, 'serie'), nNF: val(ide, 'nNF'), natOp: val(ide, 'natOp'),
      dhEmi: (val(ide, 'dhEmi') || val(ide, 'dEmi')).slice(0, 10), tpNF: val(ide, 'tpNF'), idDest: val(ide, 'idDest'), indFinal: val(ide, 'indFinal'),
      emit: { cnpj: val(emit, 'CNPJ') || val(emit, 'CPF'), nome: val(emit, 'xNome'), uf: val(bloco(emit, 'enderEmit'), 'UF'), crt: val(emit, 'CRT') },
      dest: { cnpj: val(dest, 'CNPJ') || val(dest, 'CPF'), nome: val(dest, 'xNome'), uf: val(bloco(dest, 'enderDest'), 'UF') },
      vNF: n(val(tot, 'vNF')), temIbsCbs2026: /<IBSCBS[\s>]/.test(x), itens: []
    };
    if (!nota.dest.uf) nota.dest.uf = nota.emit.uf;
    blocos(x, 'det').forEach(function (det, i) {
      var prod = bloco(det, 'prod'), imp = bloco(det, 'imposto');
      var icms = bloco(imp, 'ICMS'), ipi = bloco(imp, 'IPI'), pis = bloco(imp, 'PIS'), cof = bloco(imp, 'COFINS');
      nota.itens.push({
        nItem: i + 1, cProd: val(prod, 'cProd'), xProd: val(prod, 'xProd'), NCM: val(prod, 'NCM'), CFOP: val(prod, 'CFOP'),
        qCom: n(val(prod, 'qCom')), uCom: val(prod, 'uCom'),
        vProd: n(val(prod, 'vProd')), vFrete: n(val(prod, 'vFrete')), vSeg: n(val(prod, 'vSeg')), vOutro: n(val(prod, 'vOutro')), vDesc: n(val(prod, 'vDesc')),
        icms: {
          cst: val(icms, 'CST'), csosn: val(icms, 'CSOSN'), vBC: n(val(icms, 'vBC')), pRedBC: n(val(icms, 'pRedBC')), pICMS: n(val(icms, 'pICMS')), vICMS: n(val(icms, 'vICMS')),
          pFCP: n(val(icms, 'pFCP')), vFCP: n(val(icms, 'vFCP')), vICMSST: n(val(icms, 'vICMSST')), vFCPST: n(val(icms, 'vFCPST'))
        },
        ipi: { cst: val(ipi, 'CST'), pIPI: n(val(ipi, 'pIPI')), vIPI: n(val(ipi, 'vIPI')) },
        pis: { cst: val(pis, 'CST'), pPIS: n(val(pis, 'pPIS')), vPIS: n(val(pis, 'vPIS')) },
        cofins: { cst: val(cof, 'CST'), pCOFINS: n(val(cof, 'pCOFINS')), vCOFINS: n(val(cof, 'vCOFINS')) }
      });
    });
    return nota;
  }

  // ---------------------------------------------------------------- regime de PIS/Cofins
  var REGIMES = {
    LP: { nome: 'Lucro Presumido — cumulativo', pis: 0.65, cofins: 3 },
    LR: { nome: 'Lucro Real — não cumulativo', pis: 1.65, cofins: 7.6 },
    SN: { nome: 'Simples Nacional', pis: 0, cofins: 0 },
    INF: { nome: 'Alíquotas informadas', pis: 0, cofins: 0 }
  };
  /** Sugere o regime pelo XML: CRT 1/4 = Simples; PIS 0,65% = Presumido; 1,65% = Real. */
  function detectarRegime(nota) {
    if (nota.emit.crt === '1' || nota.emit.crt === '4') return 'SN';
    for (var i = 0; i < nota.itens.length; i++) {
      var p = nota.itens[i].pis.pPIS;
      if (Math.abs(p - 0.65) < 1e-6) return 'LP';
      if (Math.abs(p - 1.65) < 1e-6) return 'LR';
    }
    return 'LP';
  }
  // CST de PIS/Cofins sem tributo embutido na receita do item: monofásico na revenda (04), ST (05),
  // alíquota zero (06), isenta (07), sem incidência (08), suspensão (09)
  var CST_SEM_PC = { '04': 'monofásico', '05': 'subst. tributária', '06': 'alíquota zero', '07': 'isento', '08': 'sem incidência', '09': 'suspensão' };
  var CST_PC_XML = { '02': 1, '03': 1 }; // alíquota diferenciada / por unidade: usa o valor do XML

  function icmsTributado(it) { return it.icms.vICMS > 0 || it.icms.vFCP > 0; }
  /** Alíquota efetiva de ICMS (+FCP) sobre a base cheia: pICMS × (1 − redução de base). */
  function aliquotaIcms(it) {
    if (!icmsTributado(it)) return 0;
    var fr = 1 - it.icms.pRedBC / 100;
    if (it.icms.pICMS > 0) return (it.icms.pICMS + it.icms.pFCP) * fr / 100;
    var vo = valorOperacao(it);
    return vo > 0 ? (it.icms.vICMS + it.icms.vFCP) / vo : 0;
  }
  function valorOperacao(it) { return r2(it.vProd + it.vFrete + it.vSeg + it.vOutro - it.vDesc); }

  /**
   * opts: { regime, pPis, pCofins, excluirIcmsPis (Tema 69, padrão true), cbsIbsNaBaseIcms (padrão true),
   *         manterIpi (ZFM), aliq {cbs, ibsUf, ibsMun}, idx (RTC.criarIndice) }
   */
  function calcular(nota, opts) {
    opts = opts || {};
    var reg = opts.regime || detectarRegime(nota);
    var pPis = opts.pPis !== undefined ? Number(opts.pPis) : REGIMES[reg].pis;
    var pCof = opts.pCofins !== undefined ? Number(opts.pCofins) : REGIMES[reg].cofins;
    var excl = opts.excluirIcmsPis !== false, naBase = opts.cbsIbsNaBaseIcms !== false;
    var aliq = opts.aliq || RTC.PREMISSAS_PADRAO;
    var T = function () { return { vo: 0, cobrado: 0, ipi: 0, st: 0, icms: 0, pis: 0, cofins: 0, liquido: 0 }; };
    var res = { regime: reg, pPis: pPis, pCofins: pCof, excluirIcmsPis: excl, cbsIbsNaBaseIcms: naBase, manterIpi: !!opts.manterIpi, aliq: aliq, itens: [], avisos: [], hoje: T(), c: {} };
    var C = function () { return { cbs: 0, ibsUf: 0, ibsMun: 0, icms: 0, ipi: 0, st: 0, vProd: 0, total: 0 }; };
    res.c.com = C(); res.c.sem = C();
    nota.itens.forEach(function (it) {
      var vo = valorOperacao(it), icms = r2(it.icms.vICMS + it.icms.vFCP), st = r2(it.icms.vICMSST + it.icms.vFCPST), ipi = it.ipi.vIPI;
      var basePc = Math.max(0, r2(vo - (excl ? icms : 0)));
      var pis, cof, pcTxt;
      if (CST_SEM_PC[it.pis.cst]) { pis = 0; cof = 0; pcTxt = 'CST ' + it.pis.cst + ' · ' + CST_SEM_PC[it.pis.cst]; }
      else if (CST_PC_XML[it.pis.cst]) { pis = it.pis.vPIS; cof = it.cofins.vCOFINS; pcTxt = 'CST ' + it.pis.cst + ' · valor do XML'; }
      else { pis = r2(basePc * pPis / 100); cof = r2(basePc * pCof / 100); pcTxt = ''; }
      var liq = r2(vo - icms - pis - cof);
      // 2027 — classificação automática pelo NCM e CBS/IBS por fora sobre o valor líquido
      var enq = opts.idx && it.NCM ? RTC.enquadrar(opts.idx, 'ncm', it.NCM) : null;
      var cls = enq ? enq.escolhida : null;
      var calc = RTC.calcularItemRegular(liq, cls, aliq), tb = calc.tributos;
      var cbs = RTC.toNum(tb.cbs.devido), iu = RTC.toNum(tb.ibsUf.devido), im = RTC.toNum(tb.ibsMun.devido), novos = r2(cbs + iu + im);
      var a = aliquotaIcms(it);
      var cen = function (comBase) {
        var icms27 = a > 0 && a < 1 ? r2(a * (liq + (comBase ? novos : 0)) / (1 - a)) : 0;
        var vProd27 = r2(liq + icms27);
        var ipi27 = opts.manterIpi ? r2(vProd27 * it.ipi.pIPI / 100) : 0;
        return { icms: icms27, vProd: vProd27, ipi: ipi27, st: st, total: r2(vProd27 + novos + ipi27 + st) };
      };
      var x = {
        nItem: it.nItem, cProd: it.cProd, xProd: it.xProd, NCM: it.NCM, CFOP: it.CFOP,
        vo: vo, cobrado: r2(vo + ipi + st), ipi: ipi, st: st, icms: icms, aIcms: a, pis: pis, cofins: cof, pcTxt: pcTxt, liquido: liq,
        cls: cls, motivo: enq ? enq.motivo : '', pRedCbs: RTC.toNum(tb.cbs.pRed), aCbs: RTC.toNum(tb.cbs.aliquotaEfetiva), aIbs: RTC.toNum(tb.ibsUf.aliquotaEfetiva) + RTC.toNum(tb.ibsMun.aliquotaEfetiva),
        semDestaque: calc.semDestaque, cbs: cbs, ibsUf: iu, ibsMun: im, cbsIbs: novos, com: cen(true), sem: cen(false)
      };
      res.itens.push(x);
      var h = res.hoje; h.vo += vo; h.cobrado += x.cobrado; h.ipi += ipi; h.st += st; h.icms += icms; h.pis += pis; h.cofins += cof; h.liquido += liq;
      ['com', 'sem'].forEach(function (k) {
        var c = res.c[k], y = x[k];
        c.cbs += cbs; c.ibsUf += iu; c.ibsMun += im; c.icms += y.icms; c.ipi += y.ipi; c.st += y.st; c.vProd += y.vProd; c.total += y.total;
      });
      if (CST_SEM_PC[it.pis.cst] === undefined && !CST_PC_XML[it.pis.cst] && it.pis.vPIS > 0 && Math.abs(it.pis.vPIS - pis) > 0.05)
        res.avisos.push('Item ' + it.nItem + ': PIS destacado no XML (' + it.pis.vPIS.toFixed(2).replace('.', ',') + ') difere do calculado pela alíquota da empresa — confira a alíquota e a exclusão do ICMS da base.');
      if (it.icms.vICMS > 0 && !(it.icms.pICMS > 0)) res.avisos.push('Item ' + it.nItem + ': ICMS sem alíquota no XML — usada a relação ICMS/valor do item.');
    });
    var arred = function (o) { for (var k in o) if (typeof o[k] === 'number') o[k] = r2(o[k]); };
    arred(res.hoje); arred(res.c.com); arred(res.c.sem);
    res.atual = naBase ? res.c.com : res.c.sem;
    if (nota.vNF > 0 && Math.abs(nota.vNF - res.hoje.cobrado) > 0.05)
      res.avisos.push('O total da nota no XML (' + nota.vNF.toFixed(2).replace('.', ',') + ') difere da soma dos itens (' + res.hoje.cobrado.toFixed(2).replace('.', ',') + '), possivelmente por ICMS desonerado, II ou outros valores não tratados aqui.');
    if (nota.temIbsCbs2026) res.avisos.push('A nota traz CBS/IBS de teste de 2026 (0,9% e 0,1%): esses valores são informativos, não integram o preço e foram desconsiderados.');
    if (reg === 'SN') res.avisos.push('Emitente do Simples Nacional: o ICMS, o PIS e a Cofins estão dentro do DAS e não aparecem no XML. Informe as alíquotas de PIS e Cofins embutidas no DAS. Em 2027, quem continuar no DAS recolhe a CBS e o IBS dentro dele; o cálculo abaixo mostra a nota como se a empresa optasse pelo regime regular (híbrido).');
    return res;
  }

  var API = { ler: ler, calcular: calcular, detectarRegime: detectarRegime, REGIMES: REGIMES, aliquotaIcms: aliquotaIcms, valorOperacao: valorOperacao };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  root.NOTAXML = API;

  // ================================================================ interface
  if (typeof document === 'undefined') return;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var nfR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var R = function (v) { return nfR.format(v || 0); };
  var P = function (v, c) { return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: c === undefined ? 4 : c }) + '%'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function num(s) {
    s = String(s == null ? '' : s).trim().replace(/\s|%/g, '');
    if (!s) return 0;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var v = Number(s); return isFinite(v) && v >= 0 ? v : NaN;
  }
  var st = { nota: null, idx: null, res: null, arquivo: '' };
  function premissas() {
    var k = ($('#v-regime') && $('#v-regime').getAttribute('data-prem')) || 'rtc-premissas', p = null;
    try { p = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { }
    return Object.assign({}, RTC.PREMISSAS_PADRAO, p || {});
  }
  function indice() {
    if (st.idx) return Promise.resolve(st.idx);
    return fetch('data/rtc.json').then(function (r) { return r.json(); }).then(function (d) { st.idx = RTC.criarIndice(d); return st.idx; });
  }
  function carregar(file) {
    var msg = $('#nx-msg'); msg.textContent = 'Lendo ' + file.name + '…';
    Promise.all([file.text(), indice()]).then(function (a) {
      var nota = ler(a[0]);
      if (nota.erro) { msg.textContent = nota.erro; $('#nx-opc').hidden = true; $('#nx-res').hidden = true; return; }
      st.nota = nota; st.arquivo = file.name;
      var reg = detectarRegime(nota);
      $('#nx-regime').value = reg; preencherAliquotas(reg, nota);
      msg.textContent = '';
      $('#nx-opc').hidden = false;
      $('#nx-uf').textContent = nota.emit.uf + (nota.dest.uf && nota.dest.uf !== nota.emit.uf ? ' → ' + nota.dest.uf : '');
      render();
    }).catch(function (e) { msg.textContent = 'Não foi possível ler o arquivo (' + e.message + ').'; });
  }
  function preencherAliquotas(reg, nota) {
    var r = REGIMES[reg], pis = r.pis, cof = r.cofins;
    if (reg === 'INF' && nota) { var it = nota.itens.filter(function (i) { return i.pis.pPIS > 0; })[0]; if (it) { pis = it.pis.pPIS; cof = it.cofins.pCOFINS; } }
    if (reg !== 'INF' || nota) { $('#nx-pis').value = String(pis).replace('.', ','); $('#nx-cofins').value = String(cof).replace('.', ','); }
  }
  function render() {
    if (!st.nota) return;
    var pis = num($('#nx-pis').value), cof = num($('#nx-cofins').value), msg = $('#nx-msg');
    if (isNaN(pis) || isNaN(cof)) { msg.textContent = 'Alíquota de PIS/Cofins inválida.'; return; }
    msg.textContent = '';
    var res = st.res = calcular(st.nota, { regime: $('#nx-regime').value, pPis: pis, pCofins: cof, excluirIcmsPis: $('#nx-tema69').checked,
      cbsIbsNaBaseIcms: $('#nx-base').checked, manterIpi: $('#nx-ipi').checked, aliq: premissas(), idx: st.idx });
    var no = st.nota, h = res.hoje, A = res.c.com, B = res.c.sem, at = res.atual, naBase = res.cbsIbsNaBaseIcms;
    var uf = no.emit.uf || '—';
    var o = '<h2 class="sec">Nota nº ' + esc(no.nNF) + (no.emit.nome ? ' — ' + esc(no.emit.nome) : '') + ' <span class="cnt">' + esc(no.dhEmi.split('-').reverse().join('/')) + ' · ' + esc(uf) + (no.dest.uf !== no.emit.uf ? ' → ' + esc(no.dest.uf) : '') + ' · ' + no.itens.length + ' item(ns)</span></h2>';
    o += '<div class="counts">' +
      '<div class="ct"><div class="n">' + R(h.cobrado) + '</div><div class="l">Total cobrado hoje (2026), com IPI e ST</div></div>' +
      '<div class="ct a"><div class="n">' + R(h.liquido) + '</div><div class="l">Valor líquido: o que a empresa recebe sem ICMS, PIS, Cofins e IPI</div></div>' +
      '<div class="ct b"><div class="n">' + R(at.cbs + at.ibsUf + at.ibsMun) + '</div><div class="l">CBS + IBS em 2027 (por fora)</div></div>' +
      '<div class="ct c"><div class="n">' + R(at.total) + '</div><div class="l">Total da nota em 2027 — ' + (naBase ? 'CBS/IBS na base do ICMS' : 'CBS/IBS fora da base do ICMS') + '</div></div></div>';
    o += '<div class="box info"><h2><span class="ic">🧾</span>Como o valor líquido foi obtido</h2><p>Do preço de cada item (produtos + frete + seguro + outras despesas − desconto) foram retirados o <strong>ICMS (+FCP) destacado</strong> e o <strong>PIS (' + P(res.pPis) + ') e a Cofins (' + P(res.pCofins) + ')</strong> da empresa' + (res.excluirIcmsPis ? ', calculados sobre o valor sem ICMS (Tema 69 do STF)' : ', calculados sobre o valor com ICMS') + '. O <strong>IPI</strong> e o <strong>ICMS-ST</strong>, cobrados por fora do preço, também saem do total. Sobre o valor líquido, a CBS e o IBS de 2027 são calculados <strong>por fora</strong> (a base não inclui o ICMS — LC 214/2025, art. 12, § 2º) e o ICMS volta <strong>por dentro</strong>, com a mesma alíquota de hoje.</p></div>';
    var linha = function (rot, a, b, c, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + rot + '</td><td class="v">' + a + '</td><td class="v' + (naBase ? ' sel' : '') + '">' + b + '</td><td class="v' + (!naBase ? ' sel' : '') + '">' + c + '</td></tr>'; };
    var vazio = '—';
    o += '<h3 class="sub">Hoje × 2027 — nota inteira</h3><div class="tbl-wrap"><table id="nx-comp"><thead><tr><th></th><th class="v">Hoje (2026)</th><th class="v">2027 — CBS/IBS na base do ICMS' + (naBase ? ' ✓' : '') + '</th><th class="v">2027 — CBS/IBS fora da base do ICMS' + (!naBase ? ' ✓' : '') + '</th></tr></thead><tbody>' +
      linha('Valor líquido (o que a empresa recebe)', R(h.liquido), R(h.liquido), R(h.liquido), 'sub') +
      linha('(+) ICMS + FCP (por dentro)', R(h.icms), R(A.icms), R(B.icms)) +
      linha('(+) PIS', R(h.pis), vazio, vazio) +
      linha('(+) Cofins', R(h.cofins), vazio, vazio) +
      linha('(=) Valor dos produtos na nota', R(h.vo), R(A.vProd), R(B.vProd), 'sub') +
      linha('(+) CBS (por fora)', vazio, R(A.cbs), R(B.cbs)) +
      linha('(+) IBS estadual + municipal (por fora)', vazio, R(A.ibsUf + A.ibsMun), R(B.ibsUf + B.ibsMun)) +
      linha('(+) IPI (por fora)', R(h.ipi), R(A.ipi), R(B.ipi)) +
      (h.st ? linha('(+) ICMS-ST + FCP-ST (mantido)', R(h.st), R(A.st), R(B.st)) : '') +
      linha('(=) Total da nota', R(h.cobrado), R(A.total), R(B.total), 'tot') +
      linha('Tributos sobre o valor líquido', P(h.liquido ? (h.cobrado - h.liquido) / h.liquido * 100 : 0, 2), P(h.liquido ? (A.total - h.liquido) / h.liquido * 100 : 0, 2), P(h.liquido ? (B.total - h.liquido) / h.liquido * 100 : 0, 2)) +
      linha('Variação do total da nota', vazio, P(h.cobrado ? (A.total / h.cobrado - 1) * 100 : 0, 2), P(h.cobrado ? (B.total / h.cobrado - 1) * 100 : 0, 2)) +
      '</tbody></table></div>';
    o += '<h3 class="sub">Item a item</h3><div class="tbl-wrap"><table id="nx-itens"><thead><tr><th>Item</th><th>NCM · classificação 2027</th><th class="v">Preço hoje</th><th class="v">ICMS</th><th class="v">PIS + Cofins</th><th class="v">Valor líquido</th><th class="v">CBS + IBS 2027</th><th class="v">ICMS 2027</th><th class="v">Total 2027</th></tr></thead><tbody>' +
      res.itens.map(function (x) {
        var y = naBase ? x.com : x.sem, c = x.cls;
        var red = x.semDestaque ? 'sem CBS/IBS' : x.pRedCbs >= 100 ? 'alíquota zero' : x.pRedCbs > 0 ? 'redução ' + P(x.pRedCbs, 2) : 'integral';
        return '<tr><td>' + x.nItem + '. ' + esc(x.xProd.length > 40 ? x.xProd.slice(0, 37) + '…' : x.xProd) + '</td><td>' + esc(x.NCM) + (c ? '<br><span class="tag ' + (x.pRedCbs > 0 || x.semDestaque ? 'g' : 'n') + '">' + esc(c.cst + ' / ' + c.c) + ' · ' + red + '</span>' : '') + '</td>' +
          '<td class="v">' + R(x.vo) + '</td><td class="v">' + R(x.icms) + (x.aIcms ? '<br><small>' + P(x.aIcms * 100, 2) + '</small>' : '') + '</td><td class="v">' + R(x.pis + x.cofins) + (x.pcTxt ? '<br><small>' + esc(x.pcTxt) + '</small>' : '') + '</td>' +
          '<td class="v"><strong>' + R(x.liquido) + '</strong></td><td class="v">' + R(x.cbsIbs) + '<br><small>' + P(x.aCbs + x.aIbs, 4) + '</small></td><td class="v">' + R(y.icms) + '</td><td class="v">' + R(y.total) + '</td></tr>';
      }).join('') + '<tr class="tot"><td colspan="2">Total</td><td class="v">' + R(h.vo) + '</td><td class="v">' + R(h.icms) + '</td><td class="v">' + R(h.pis + h.cofins) + '</td><td class="v">' + R(h.liquido) + '</td><td class="v">' + R(at.cbs + at.ibsUf + at.ibsMun) + '</td><td class="v">' + R(at.icms) + '</td><td class="v">' + R(at.total) + '</td></tr></tbody></table></div>';
    if (res.avisos.length) o += '<div class="box alert"><h2>Avisos</h2><ul>' + res.avisos.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>';
    o += '<div class="box plain"><h2>Premissas do cálculo</h2><ul>' +
      '<li>CBS ' + P(res.aliq.cbs) + ' e IBS ' + P(Number(res.aliq.ibsUf) + Number(res.aliq.ibsMun)) + ' (estadual ' + P(res.aliq.ibsUf) + ' + municipal ' + P(res.aliq.ibsMun) + '), com a classificação de cada NCM identificada automaticamente nas tabelas oficiais (reduções da LC 214/2025). As alíquotas podem ser alteradas na aba Premissas.</li>' +
      '<li>ICMS de 2027 com a mesma alíquota (e redução de base) do XML. ' + (naBase ? '<strong>Cenário selecionado: a CBS e o IBS compõem a base do ICMS</strong> — situação atual em todos os estados enquanto não houver mudança na legislação estadual.' : '<strong>Cenário selecionado: a CBS e o IBS não compõem a base do ICMS</strong> no estado ' + esc(uf) + '.') + ' A tabela mostra os dois cenários.</li>' +
      '<li>PIS e Cofins deixam de existir em 2027. O IPI ' + (res.manterIpi ? 'foi mantido (produto com industrialização incentivada na Zona Franca de Manaus).' : 'tem alíquota zero a partir de 2027 (exceto produtos com industrialização incentivada na Zona Franca de Manaus).') + '</li>' +
      '<li>O ICMS-ST e o DIFAL não foram recalculados. A CBS e o IBS destacados geram crédito para o comprador do regime regular.</li></ul></div>';
    o += '<div class="disc">Simulação aproximada para planejamento de preços, a partir do XML informado e das premissas acima. Não substitui a análise da legislação federal e estadual aplicável à operação.</div>';
    o += '<div class="btns no-print"><button class="btn sec" type="button" onclick="window.print()">Imprimir / salvar PDF</button><button class="btn sec" type="button" id="nx-csv">Exportar (CSV)</button></div>';
    var el = $('#nx-res'); el.innerHTML = o; el.hidden = false;
    $('#nx-csv').addEventListener('click', exportar);
  }
  function exportar() {
    var res = st.res; if (!res) return;
    var f = function (v) { return (v || 0).toFixed(2).replace('.', ','); };
    var l = ['item;descricao;ncm;cclasstrib;preco_hoje;icms_fcp;pis;cofins;ipi;st;valor_liquido;cbs;ibs_uf;ibs_mun;icms_2027_com_cbsibs_na_base;total_2027_com;icms_2027_sem;total_2027_sem'];
    res.itens.forEach(function (x) { l.push([x.nItem, '"' + x.xProd.replace(/"/g, "'") + '"', x.NCM, x.cls ? x.cls.c : '', f(x.vo), f(x.icms), f(x.pis), f(x.cofins), f(x.ipi), f(x.st), f(x.liquido), f(x.cbs), f(x.ibsUf), f(x.ibsMun), f(x.com.icms), f(x.com.total), f(x.sem.icms), f(x.sem.total)].join(';')); });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + l.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'nota-' + (st.nota.nNF || 'xml') + '-2026x2027.csv'; document.body.appendChild(a); a.click(); a.remove();
  }
  function init() {
    var inp = $('#nx-file'); if (!inp) return;
    inp.addEventListener('change', function () { if (inp.files[0]) carregar(inp.files[0]); inp.value = ''; });
    var dz = $('#nx-drop');
    ['dragenter', 'dragover'].forEach(function (e) { dz.addEventListener(e, function (ev) { ev.preventDefault(); dz.classList.add('on'); }); });
    ['dragleave', 'drop'].forEach(function (e) { dz.addEventListener(e, function (ev) { ev.preventDefault(); dz.classList.remove('on'); }); });
    dz.addEventListener('drop', function (ev) { var f = ev.dataTransfer.files[0]; if (f) carregar(f); });
    dz.addEventListener('click', function () { inp.click(); });
    dz.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); inp.click(); } });
    $('#nx-regime').addEventListener('change', function () { preencherAliquotas($('#nx-regime').value, st.nota); render(); });
    ['#nx-pis', '#nx-cofins'].forEach(function (s) { $(s).addEventListener('input', function () { if ($('#nx-regime').value !== 'INF') $('#nx-regime').value = 'INF'; render(); }); });
    ['#nx-tema69', '#nx-base', '#nx-ipi'].forEach(function (s) { $(s).addEventListener('change', render); });
    window.addEventListener('storage', render);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
