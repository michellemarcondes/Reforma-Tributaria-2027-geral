/* Interface do site - Calculadora CBS/IBS 2027. Usa window.RTC (engine.js). */
(function () {
  'use strict';
  var R = window.RTC;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var DATA = null, IDX = null, NCM = null, NBS = null;

  // ------------------------------------------------------------------ armazenamento local (tolerante a falhas)
  var store = {
    get: function (k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } }
  };

  // ------------------------------------------------------------------ numeros
  // Aceita "2000", "2.000", "2.000,00", "2000,5", "2,000.50", "1234.56" e "R$ 1.234,56".
  // Ponto unico seguido de exatamente 3 digitos (ex.: 18.000) e separador de milhar, exceto em
  // campos de percentual (pct=true) ou quando a parte inteira e 0 (ex.: 0.125).
  function parseNum(s, pct) {
    s = String(s == null ? '' : s).trim().replace(/\s|R\$|%/g, '');
    if (!s) return { ok: true, v: '0', vazio: true };
    var temV = s.indexOf(',') >= 0, temP = s.indexOf('.') >= 0;
    if (temV && temP) {
      if (s.lastIndexOf('.') > s.lastIndexOf(',')) s = s.replace(/,/g, '');      // 2,000.50
      else s = s.replace(/\./g, '').replace(',', '.');                            // 2.000,50
    } else if (temV) {
      if (s.split(',').length > 2) s = s.replace(/,/g, '');                       // 1,000,000
      else s = s.replace(',', '.');                                               // 2000,50
    } else if (temP) {
      var pp = s.split('.');
      if (pp.length > 2) s = s.replace(/\./g, '');                                // 1.000.000
      else if (!pct && pp[1].length === 3 && /^-?[1-9]\d{0,2}$/.test(pp[0])) s = pp[0] + pp[1]; // 18.000
    }
    if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, v: '0' };
    return { ok: true, v: s, vazio: false };
  }
  function ehPct(el) { return !!(el && el.hasAttribute && el.hasAttribute('data-pct')); }
  // ao sair do campo, mostra o numero interpretado no formato brasileiro (ex.: 2.000 -> 2.000,00)
  function formatarCampo(el) {
    var r = parseNum(el.value, ehPct(el));
    if (!r.ok || r.vazio) return;
    var n = Number(r.v);
    var txt = ehPct(el) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 })
      : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (txt !== el.value) { el.value = txt; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  var nfBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function brl(v) { return nfBRL.format(Number(R.toStr(typeof v === 'bigint' ? v : R.D(v), 2))); }
  function pct(v, casas) {
    casas = casas == null ? 2 : casas;
    var n = Number(R.toStr(typeof v === 'bigint' ? v : R.D(v), casas));
    return n.toLocaleString('pt-BR', { minimumFractionDigits: Math.min(2, casas), maximumFractionDigits: casas }) + '%';
  }
  function numBR(n, casas) { return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas || 4 }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function fmtNcm(c) { return c.length === 8 ? c.slice(0, 4) + '.' + c.slice(4, 6) + '.' + c.slice(6) : c; }
  function fmtNbs(c) { return c.length === 9 ? c.slice(0, 1) + '.' + c.slice(1, 5) + '.' + c.slice(5, 7) + '.' + c.slice(7) : c; }

  // ------------------------------------------------------------------ premissas
  function premissas() {
    var p = store.get('rtcg-premissas', null);
    return p ? Object.assign({}, R.PREMISSAS_PADRAO, p) : Object.assign({}, R.PREMISSAS_PADRAO);
  }
  function aliqTexto(p) {
    return 'CBS ' + numBR(p.cbs, 4) + '% · IBS ' + numBR(Number(p.ibsUf) + Number(p.ibsMun), 4) + '%';
  }
  function atualizaMeta() {
    var p = premissas();
    $('#meta-aliq').textContent = aliqTexto(p);
    $('#pr-cbs').value = numBR(p.cbs, 4); $('#pr-uf').value = numBR(p.ibsUf, 4); $('#pr-mun').value = numBR(p.ibsMun, 4);
  }

  // ------------------------------------------------------------------ abas
  var TABS = { sim: 'simulador', painel: 'painel', nota: 'nota', prem: 'premissas' };
  function abrir(id, push) {
    $$('.tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.id === 't-' + id)); });
    $$('section.view').forEach(function (v) { v.hidden = v.id !== 'v-' + id; });
    if (push !== false) { try { history.replaceState(null, '', '#' + TABS[id]); } catch (e) { } }
    if (id === 'nota') carregaNomenclaturas();
  }
  function tabDoHash() {
    var h = (location.hash || '').replace('#', '');
    for (var k in TABS) if (TABS[k] === h) return k;
    return 'sim';
  }

  // ------------------------------------------------------------------ anexos do Simples
  function opcoesAnexo(sel) {
    var txt = {
      I: 'Anexo I — Comércio (revenda de mercadorias)',
      II: 'Anexo II — Indústria',
      III: 'Anexo III — Serviços (e Anexo V com Fator R ≥ 28%)',
      IV: 'Anexo IV — Serviços (construção, limpeza, vigilância, advocacia)',
      V: 'Anexo V — Serviços intelectuais com Fator R < 28%'
    };
    sel.innerHTML = Object.keys(txt).map(function (k) { return '<option value="' + k + '">' + txt[k] + '</option>'; }).join('');
  }

  // ================================================================== 1. SIMULADOR
  function montaFaixas() {
    $('#s-fat').innerHTML = R.CATEGORIAS.map(function (c) {
      var cls = c.paga === 100 ? '' : (c.paga === 0 ? ' z' : ' r');
      var paga = c.k === 'naoInc' ? 'sem CBS/IBS' : (c.paga === 0 ? 'paga 0% da alíquota' : 'paga ' + c.paga + '% da alíquota');
      return '<div class="faixa' + cls + '"><label for="s-f-' + c.k + '">' + esc(c.nome) + '<span class="paga">' + paga + '</span></label>' +
        '<input id="s-f-' + c.k + '" data-faixa="' + c.k + '" class="num" inputmode="decimal" placeholder="0,00" aria-describedby="s-fx-' + c.k + '">' +
        '<span class="ex" id="s-fx-' + c.k + '">' + esc(c.ex) + '</span></div>';
    }).join('');
    $('#s-fat').addEventListener('input', totalFaixas);
  }
  function lerFaixas() {
    var out = {}, tot = 0n, erro = null;
    $$('#s-fat input').forEach(function (i) {
      var r = parseNum(i.value);
      i.setAttribute('aria-invalid', String(!r.ok));
      if (!r.ok && !erro) erro = i;
      out[i.dataset.faixa] = r.ok && !r.vazio ? r.v : '0';
      if (r.ok) tot += R.D(r.v);
    });
    return { fat: out, total: tot, erro: erro };
  }
  function totalFaixas() { var f = lerFaixas(); $('#s-bruto-total').textContent = brl(f.total); }
  function regimeHint(reg) {
    return {
      LP: 'Apura CBS/IBS pelo regime regular, com créditos sobre as compras.',
      LR: 'Apura CBS/IBS pelo regime regular, com créditos sobre as compras.',
      SN: 'CBS e IBS recolhidos dentro do DAS, por alíquota efetiva do anexo. Sem créditos.',
      SNH: 'Paga o DAS sem a parcela de CBS/IBS e apura CBS/IBS como no regime regular.'
    }[reg] || '';
  }
  function toggleSim() {
    var reg = $('#s-regime').value;
    $('#s-regime-hint').textContent = regimeHint(reg);
    var sn = reg === 'SN' || reg === 'SNH';
    $$('#f-sim .only-sn').forEach(function (e) { e.hidden = !sn; });
    $$('#f-sim .only-reg').forEach(function (e) { e.hidden = reg === 'SN'; });
    $('#s-sn-nota').hidden = reg !== 'SN';
    $('#s-pcbs').closest('.field').hidden = reg !== 'SN';
    $('#s-pibs').closest('.field').hidden = reg !== 'SN';
  }

  function lerCampos(form, nomes, msgEl) {
    var out = {}, erro = null;
    nomes.forEach(function (n) {
      var el = form.querySelector('[name="' + n + '"]');
      var r = parseNum(el.value, ehPct(el));
      el.setAttribute('aria-invalid', String(!r.ok));
      if (!r.ok && !erro) erro = el;
      out[n] = r.vazio ? '' : r.v;
    });
    if (erro) { msgEl.textContent = 'Valor inválido em "' + erro.closest('.field').querySelector('label').textContent + '". Use números, ex.: 12.345,67'; erro.focus(); return null; }
    return out;
  }

  function simular(ev) {
    ev.preventDefault();
    var f = $('#f-sim'), msg = $('#s-msg'); msg.textContent = '';
    var nome = $('#s-nome').value.trim();
    if (!nome) { msg.textContent = 'Informe o nome da empresa.'; $('#s-nome').focus(); return; }
    var v = lerCampos(f, ['descontos', 'icms', 'iss', 'rbt12', 'pCBSSN', 'pIBSSN', 'comprasRegular', 'comprasSimples', 'aliqCreditoSimples'], msg);
    if (!v) return;
    var fx = lerFaixas();
    if (fx.erro) { msg.textContent = 'Valor inválido em "' + fx.erro.closest('.faixa').querySelector('label').firstChild.textContent + '". Use números, ex.: 12.345,67'; fx.erro.focus(); return; }
    if (!(fx.total > 0n)) { msg.textContent = 'Informe o faturamento do mês em pelo menos uma faixa (se não souber separar, use “Tributado integralmente”).'; $('#s-f-integral').focus(); return; }
    var reg = $('#s-regime').value;
    var e = {
      regime: reg, faturamento: fx.fat, descontos: v.descontos,
      icms: reg === 'SN' ? 0 : v.icms, iss: reg === 'SN' ? 0 : v.iss,
      comprasRegular: v.comprasRegular, comprasSimples: v.comprasSimples, aliqCreditoSimples: v.aliqCreditoSimples,
      anexo: $('#s-anexo').value, rbt12: v.rbt12 || '', premissas: premissas()
    };
    if (reg === 'SN' && v.pCBSSN !== '') { e.pCBSSN = v.pCBSSN; e.pIBSSN = v.pIBSSN || '0'; }
    var res = R.simularEmpresa(e);
    renderSim(nome, $('#s-mes').value, res, e);
  }

  function linha(rotulo, valor, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + rotulo + '</td><td class="v">' + valor + '</td></tr>'; }

  function renderSim(nome, mes, r, e) {
    var p = e.premissas, el = $('#s-res');
    var mesTxt = mes ? new Date(mes + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '2027';
    var h = '<h2 class="sec">Resultado — ' + esc(nome) + ' <span class="cnt">' + esc(mesTxt) + '</span></h2>';
    h += '<p style="margin:0 0 4px"><span class="tag">' + esc(r.regimeNome) + '</span> <span class="tag n">' + esc(aliqTexto(p)) + '</span></p>';
    var sn = r.regime === 'SN';
    h += '<div class="counts">';
    if (sn) {
      h += '<div class="ct"><div class="n">' + brl(r.cbsRecolher) + '</div><div class="l">CBS estimada dentro do DAS</div></div>';
      h += '<div class="ct b"><div class="n">' + brl(r.ibsRecolher) + '</div><div class="l">IBS estimado dentro do DAS</div></div>';
      h += '<div class="ct a"><div class="n">' + brl(r.das) + '</div><div class="l">DAS total estimado (todos os tributos do Simples)</div></div>';
      h += '<div class="ct c"><div class="n">' + pct(r.cargaEfetiva, 2) + '</div><div class="l">Carga de CBS + IBS sobre o faturamento</div></div>';
    } else {
      h += '<div class="ct"><div class="n">' + brl(r.cbsRecolher) + '</div><div class="l">CBS a recolher (débitos − créditos)</div></div>';
      h += '<div class="ct b"><div class="n">' + brl(r.ibsRecolher) + '</div><div class="l">IBS a recolher (estadual + municipal)</div></div>';
      h += '<div class="ct a"><div class="n">' + brl(r.totalRecolher) + '</div><div class="l">Total estimado de CBS + IBS no mês</div></div>';
      h += '<div class="ct c"><div class="n">' + pct(r.cargaEfetiva, 2) + '</div><div class="l">Carga efetiva sobre o faturamento bruto</div></div>';
    }
    h += '</div>';
    if (r.saldoCredor > 0n) h += '<div class="box ok"><h2><span class="ic">✅</span>Saldo credor</h2><p>Os créditos superam os débitos em <strong>' + brl(r.saldoCredor) + '</strong>. O saldo pode ser compensado nos períodos seguintes ou objeto de pedido de ressarcimento, nos termos da LC 214/2025.</p></div>';

    // quadro por faixa de tributacao
    var sn2 = r.regime === 'SN';
    h += '<h3 class="sub">Cálculo por faixa de tributação</h3><div class="tbl-wrap"><table><thead><tr><th>Faixa</th><th class="v">Faturamento</th><th class="v">(−) Deduções</th><th class="v">Base de cálculo</th><th class="v">Alíq. efetiva CBS</th><th class="v">CBS</th><th class="v">IBS</th></tr></thead><tbody>';
    var tf = 0n, td = 0n;
    r.porCategoria.forEach(function (c) {
      tf += c.faturamento; td += c.deducoes;
      h += '<tr><td>' + esc(c.nome) + (sn2 ? '' : ' <span class="bdg' + (c.paga < 100 ? ' g' : '') + '">' + (c.k === 'naoInc' ? 'sem CBS/IBS' : 'paga ' + c.paga + '%') + '</span>') + '</td><td class="v">' + brl(c.faturamento) + '</td><td class="v">' + brl(c.deducoes) + '</td><td class="v">' + brl(c.base) + '</td><td class="v">' + pct(c.aliqCbs, 4) + '</td><td class="v">' + brl(c.cbs) + '</td><td class="v">' + brl(c.ibs) + '</td></tr>';
    });
    h += '<tr class="tot"><td>Total</td><td class="v">' + brl(tf) + '</td><td class="v">' + brl(td) + '</td><td class="v">' + brl(r.base) + '</td><td></td><td class="v">' + brl(r.cbsDebito) + '</td><td class="v">' + brl(r.ibsDebito) + '</td></tr></tbody></table></div>';

    h += '<h3 class="sub">Memória de cálculo</h3><div class="tbl-wrap"><table class="mem"><tbody>';
    h += linha('Faturamento bruto (soma das faixas)', brl(r.receitaBruta));
    if (sn) {
      h += linha('(−) Descontos e devoluções', brl(r.descontos));
      var s = r.simples;
      h += linha(esc(s.anexoNome) + ' — ' + s.faixa + 'ª faixa (RBT12 ' + brl(s.rbt12) + ')', 'nominal ' + pct(s.aliquotaNominal, 2) + ' · dedução ' + brl(s.parcelaDeduzir));
      h += linha('Alíquota efetiva do DAS', pct(s.aliquotaEfetiva, 4));
      if (s.informadoPgdas) h += linha('Alíquotas de CBS/IBS informadas do PGDAS', 'pCBSSN ' + pct(s.pCBSSN, 4) + ' · pIBSSN ' + pct(s.pIBSSN, 4));
      else h += linha('Partilha 2027 do anexo: CBS ' + pct(s.repCBS, 2) + ' · IBS ' + pct(s.repIBS, 2) + (s.tetoIssAplicado ? ' (sobre o excedente; ISS limitado a 5%)' : ''), 'pCBSSN ' + pct(s.pCBSSN, 4) + ' · pIBSSN ' + pct(s.pIBSSN, 4));
      h += linha('CBS dentro do DAS', brl(r.cbsDebito));
      h += linha('IBS dentro do DAS', brl(r.ibsDebito));
      h += linha('Demais tributos do DAS (IRPJ, CSLL, CPP, ICMS/ISS…)', brl(r.dasSemCbsIbs));
      h += linha('= DAS total estimado', brl(r.das), 'tot');
      if (s.excedeLimite) h += '</tbody></table></div><div class="box alert"><h2>Atenção</h2><p>RBT12 acima de R$ 4,8 milhões: a empresa excede o limite do Simples Nacional.</p></div><div class="tbl-wrap"><table class="mem"><tbody>';
    } else {
      h += linha('(−) Descontos e devoluções', brl(r.descontos));
      h += linha('(−) ICMS/FCP destacados', brl(r.icms));
      h += linha('(−) ISS', brl(r.iss));
      h += linha('= Receita líquida (base de cálculo da CBS/IBS)', brl(r.base), 'sub');
      h += linha('Débitos de CBS + IBS (quadro acima)', 'CBS ' + brl(r.cbsDebito) + ' · IBS ' + brl(r.ibsDebito));
      h += linha('Total de débitos (CBS + IBS)', brl(r.cbsDebito + r.ibsDebito), 'sub');
      h += linha('(−) Créditos sobre compras do regime regular (' + brl(R.D(e.comprasRegular)) + ')', brl(r.creditoRegular), 'neg');
      if (r.creditoSimples > 0n) h += linha('(−) Créditos sobre compras do Simples (' + brl(R.D(e.comprasSimples)) + ' × ' + pct(R.D(e.aliqCreditoSimples || 0), 2) + ')', brl(r.creditoSimples), 'neg');
      h += linha('CBS a recolher', brl(r.cbsRecolher));
      h += linha('IBS a recolher', brl(r.ibsRecolher));
      h += linha('= Total CBS + IBS', brl(r.totalRecolher), 'tot');
      if (r.regime === 'SNH') {
        h += linha('DAS sem a parcela de CBS/IBS (' + esc(r.simples.anexoNome) + ', ' + r.simples.faixa + 'ª faixa, alíquota efetiva ' + pct(r.simples.aliquotaEfetiva, 4) + ')', brl(r.dasSemCbsIbs));
        h += linha('= Desembolso estimado (DAS + CBS/IBS)', brl(r.dasSemCbsIbs + r.totalRecolher), 'tot');
      }
    }
    h += '</tbody></table></div>';
    if (r.pisCofins2026 !== undefined) {
      var dif = r.totalRecolher - r.pisCofins2026;
      h += '<div class="box info"><h2><span class="ic">📊</span>Comparativo com 2026 (PIS/Cofins)</h2><p>Com o mesmo faturamento, o PIS/Cofins de 2026 seria de aproximadamente <strong>' + brl(r.pisCofins2026) + '</strong> — ' + esc(r.pisCofinsNota) + ' Em 2027 a CBS + IBS estimada é <strong>' + brl(r.totalRecolher) + '</strong> (' + (dif >= 0n ? 'acréscimo de ' : 'redução de ') + brl(dif >= 0n ? dif : -dif) + ').</p></div>';
    }
    r.avisos.forEach(function (a) { h += '<div class="box plain"><p>' + esc(a) + '</p></div>'; });
    h += '<div class="disc">Estimativa baseada nas informações fornecidas e nas regras da Calculadora RTC da Receita Federal. Depende da veracidade dos dados e das alíquotas efetivamente fixadas para 2027. Não substitui a apuração oficial nem a análise do caso concreto.</div>';
    h += '<div class="btns no-print"><button class="btn sec" type="button" onclick="window.print()">Imprimir / salvar PDF</button></div>';
    el.innerHTML = h; el.hidden = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ================================================================== 2. PAINEL
  var linhas = [];
  var REG_OPTS = [['LP', 'Lucro Presumido'], ['LR', 'Lucro Real'], ['SN', 'Simples padrão'], ['SNH', 'Simples regime regular']];
  function salvarPainel() { store.set('rtcg-painel', linhas); }
  function calcLinha(l) {
    var n = function (x) { var r = parseNum(x); return r.ok ? r.v : null; };
    var fat = n(l.fat), ded = n(l.ded), cmp = n(l.compras), rbt = n(l.rbt12);
    if (fat === null || ded === null || cmp === null || rbt === null) return { erro: 'valor inválido' };
    if (!(Number(fat) > 0)) return { vazio: true };
    var reg = l.regime in R.REGIMES ? l.regime : 'LP';
    return R.simularEmpresa({ regime: reg, receitaBruta: fat, descontos: ded, comprasRegular: cmp, anexo: l.anexo || 'I', rbt12: Number(rbt) > 0 ? rbt : '', premissas: premissas() });
  }
  function celulasRes(tr, l) {
    var r = calcLinha(l);
    var tds = tr.querySelectorAll('td.res');
    if (r.erro || r.vazio) { tds[0].textContent = r.erro ? 'verifique' : '—'; tds[1].textContent = '—'; tds[2].textContent = '—'; tds[3].textContent = '—'; return r; }
    tds[0].textContent = brl(r.cbsRecolher); tds[1].textContent = brl(r.ibsRecolher); tds[2].textContent = brl(r.totalRecolher); tds[3].textContent = pct(r.cargaEfetiva, 2);
    return r;
  }
  function renderPainel() {
    var tb = $('#p-tab tbody');
    tb.innerHTML = linhas.map(function (l, i) {
      var sn = l.regime === 'SN' || l.regime === 'SNH';
      return '<tr data-i="' + i + '">' +
        '<td><input class="nm" data-k="nome" value="' + esc(l.nome) + '" placeholder="Nome do cliente" aria-label="Nome do cliente"></td>' +
        '<td><select data-k="regime" aria-label="Regime">' + REG_OPTS.map(function (o) { return '<option value="' + o[0] + '"' + (l.regime === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></td>' +
        '<td><input class="num" data-k="fat" value="' + esc(l.fat) + '" inputmode="decimal" placeholder="0,00" aria-label="Faturamento bruto"></td>' +
        '<td><input class="num" data-k="ded" value="' + esc(l.ded) + '" inputmode="decimal" placeholder="0,00" aria-label="Deduções"></td>' +
        '<td><input class="num" data-k="compras" value="' + esc(l.compras) + '" inputmode="decimal" placeholder="0,00" aria-label="Compras com crédito"' + (l.regime === 'SN' ? ' disabled title="Simples padrão não apropria créditos"' : '') + '></td>' +
        '<td><select data-k="anexo" aria-label="Anexo"' + (sn ? '' : ' disabled') + '>' + ['I', 'II', 'III', 'IV', 'V'].map(function (a) { return '<option' + (l.anexo === a ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></td>' +
        '<td><input class="num" data-k="rbt12" value="' + esc(l.rbt12) + '" inputmode="decimal" placeholder="fat. × 12" aria-label="RBT12"' + (sn ? '' : ' disabled') + '></td>' +
        '<td class="v res"></td><td class="v res"></td><td class="v res"></td><td class="v res"></td>' +
        '<td class="no-print"><button class="btn link" data-del="' + i + '" type="button" aria-label="Remover cliente">✕</button></td></tr>';
    }).join('');
    $$('tr', tb).forEach(function (tr) { celulasRes(tr, linhas[+tr.dataset.i]); });
    totaisPainel();
  }
  function totaisPainel() {
    var cbs = 0n, ibs = 0n, fat = 0n, n = 0;
    linhas.forEach(function (l) { var r = calcLinha(l); if (r.erro || r.vazio) return; n++; cbs += r.cbsRecolher; ibs += r.ibsRecolher; fat += r.receitaBruta; });
    var tot = cbs + ibs;
    $('#p-cnt').textContent = linhas.length + (linhas.length === 1 ? ' cliente' : ' clientes');
    $('#p-tab tfoot').innerHTML = linhas.length ? '<tr class="tot"><td colspan="2">Total (' + n + ' calculados)</td><td class="v">' + brl(fat) + '</td><td></td><td></td><td></td><td></td><td class="v">' + brl(cbs) + '</td><td class="v">' + brl(ibs) + '</td><td class="v">' + brl(tot) + '</td><td class="v">' + (fat > 0n ? pct(R.dec.div(R.dec.mul(tot, R.D(100)), fat), 2) : '—') + '</td><td class="no-print"></td></tr>' : '<tr><td colspan="12" style="text-align:center;color:var(--ink3);padding:22px">Nenhum cliente. Use “+ Adicionar cliente”, “Importar CSV” ou “Carregar exemplo”.</td></tr>';
    $('#p-counts').innerHTML =
      '<div class="ct"><div class="n">' + n + '</div><div class="l">Clientes calculados</div></div>' +
      '<div class="ct b"><div class="n">' + brl(cbs) + '</div><div class="l">CBS total estimada</div></div>' +
      '<div class="ct b"><div class="n">' + brl(ibs) + '</div><div class="l">IBS total estimado</div></div>' +
      '<div class="ct a"><div class="n">' + brl(tot) + '</div><div class="l">Total CBS + IBS da carteira</div></div>';
  }
  function novoCliente(d) { return Object.assign({ nome: '', regime: 'LP', fat: '', ded: '', compras: '', anexo: 'I', rbt12: '' }, d || {}); }
  function eventosPainel() {
    var tb = $('#p-tab tbody');
    tb.addEventListener('input', function (ev) {
      var el = ev.target, tr = el.closest('tr'); if (!tr || !el.dataset.k) return;
      var l = linhas[+tr.dataset.i]; l[el.dataset.k] = el.value;
      if (el.classList.contains('num')) el.setAttribute('aria-invalid', String(!parseNum(el.value).ok));
      celulasRes(tr, l); totaisPainel(); salvarPainel();
    });
    tb.addEventListener('change', function (ev) { if (ev.target.dataset.k === 'regime') { salvarPainel(); renderPainel(); } });
    tb.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-del]'); if (!b) return;
      linhas.splice(+b.dataset.del, 1); salvarPainel(); renderPainel();
    });
    $('#p-add').addEventListener('click', function () {
      linhas.push(novoCliente()); salvarPainel(); renderPainel();
      var ins = $$('#p-tab tbody input.nm'); if (ins.length) ins[ins.length - 1].focus();
    });
    $('#p-clear').addEventListener('click', function () { if (linhas.length && confirm('Remover todos os clientes do painel?')) { linhas = []; salvarPainel(); renderPainel(); } });
    $('#p-print').addEventListener('click', function () { window.print(); });
    $('#p-exemplo').addEventListener('click', function () {
      linhas = linhas.concat([
        novoCliente({ nome: 'Comercial Alfa Ltda.', regime: 'LP', fat: '250.000,00', ded: '45.000,00', compras: '120.000,00' }),
        novoCliente({ nome: 'Indústria Beta S.A.', regime: 'LR', fat: '1.200.000,00', ded: '216.000,00', compras: '700.000,00' }),
        novoCliente({ nome: 'Clínica Gama', regime: 'SN', fat: '80.000,00', ded: '0', anexo: 'III', rbt12: '900.000,00' }),
        novoCliente({ nome: 'Serviços Delta ME', regime: 'SNH', fat: '60.000,00', ded: '3.000,00', compras: '15.000,00', anexo: 'III', rbt12: '700.000,00' })
      ]);
      salvarPainel(); renderPainel();
    });
    $('#p-modelo').addEventListener('click', function () {
      baixar('modelo-clientes.csv', 'nome;regime;faturamento;deducoes;compras;anexo;rbt12\nComercial Exemplo Ltda.;LP;250000,00;45000,00;120000,00;;\nPadaria Exemplo ME;SN;60000,00;0;;I;650000,00\n');
    });
    $('#p-export').addEventListener('click', function () {
      if (!linhas.length) { $('#p-msg').textContent = 'Nada para exportar.'; return; }
      var csv = ['nome;regime;faturamento;deducoes;compras;anexo;rbt12;cbs;ibs;total_cbs_ibs;carga_pct'];
      linhas.forEach(function (l) {
        var r = calcLinha(l), ok = !(r.erro || r.vazio);
        var c = function (v) { return ok ? R.toStr(v, 2).replace('.', ',') : ''; };
        csv.push([l.nome, l.regime, l.fat, l.ded, l.compras, (l.regime === 'SN' || l.regime === 'SNH') ? l.anexo : '', l.rbt12, c(r.cbsRecolher), c(r.ibsRecolher), c(r.totalRecolher), ok ? R.toStr(r.cargaEfetiva, 2).replace('.', ',') : ''].map(csvCampo).join(';'));
      });
      baixar('painel-cbs-ibs-2027.csv', csv.join('\n') + '\n');
    });
    $('#p-file').addEventListener('change', function (ev) {
      var f = ev.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { importarCsv(String(rd.result)); ev.target.value = ''; };
      rd.readAsText(f, 'utf-8');
    });
  }
  function csvCampo(v) { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function baixar(nome, texto) {
    var blob = new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function parseCsv(txt) {
    txt = txt.replace(/^﻿/, '');
    var sep = (txt.split('\n')[0].match(/;/g) || []).length >= (txt.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < txt.length; i++) {
      var ch = txt[i];
      if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(function (c) { return c.trim(); })) rows.push(row); row = []; }
      else cur += ch;
    }
    row.push(cur); if (row.some(function (c) { return c.trim(); })) rows.push(row);
    return rows;
  }
  function importarCsv(txt) {
    var rows = parseCsv(txt), msg = $('#p-msg');
    if (!rows.length) { msg.textContent = 'Arquivo vazio.'; return; }
    var head = rows[0].map(norm), temHead = head.some(function (h) { return /nome|cliente|regime|fatur/.test(h); });
    var col = function (re, def) { if (!temHead) return def; for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
    var ix = { nome: col(/nome|cliente|empresa/, 0), regime: col(/regime/, 1), fat: col(/fatur|receita|bruto/, 2), ded: col(/dedu/, 3), compras: col(/compra|credito/, 4), anexo: col(/anexo/, 5), rbt12: col(/rbt/, 6) };
    var mapaReg = function (s) {
      s = norm(s).replace(/\s/g, '');
      if (/^(lr|lucroreal)/.test(s)) return 'LR';
      if (/^(snh|simplesregular|simpleshibrido|hibrido)/.test(s)) return 'SNH';
      if (/^(sn|simples)/.test(s)) return 'SN';
      return 'LP';
    };
    var novos = 0, ruins = 0;
    rows.slice(temHead ? 1 : 0).forEach(function (r) {
      var g = function (k) { return ix[k] >= 0 && r[ix[k]] != null ? String(r[ix[k]]).trim() : ''; };
      if (!g('nome') && !g('fat')) return;
      var l = novoCliente({ nome: g('nome'), regime: mapaReg(g('regime')), fat: g('fat'), ded: g('ded'), compras: g('compras'), anexo: (g('anexo').toUpperCase().replace(/[^IV]/g, '') || 'I'), rbt12: g('rbt12') });
      if (!R.ANEXOS[l.anexo]) l.anexo = 'I';
      if (!parseNum(l.fat).ok) ruins++;
      linhas.push(l); novos++;
    });
    salvarPainel(); renderPainel();
    msg.textContent = novos + ' cliente(s) importado(s)' + (ruins ? '; ' + ruins + ' com faturamento inválido — revise as linhas marcadas.' : '.');
    msg.style.color = ruins ? 'var(--red)' : 'var(--green-dk)';
  }

  // ================================================================== 3. NOTA
  var ncmMapa = null, nbsMapa = null, folhasNcm = null, folhasNbs = null, codSel = null;
  var carregandoNom = null;
  function carregaNomenclaturas() {
    if (carregandoNom) return carregandoNom;
    carregandoNom = Promise.all([fetch('data/ncm.json').then(function (r) { return r.json(); }), fetch('data/nbs.json').then(function (r) { return r.json(); })])
      .then(function (a) {
        NCM = a[0]; NBS = a[1];
        ncmMapa = {}; NCM.forEach(function (r) { ncmMapa[r[0]] = r[1]; });
        nbsMapa = {}; NBS.forEach(function (r) { nbsMapa[r[0]] = r[1]; });
        folhasNcm = NCM.filter(function (r) { return r[0].length === 8; }).map(function (r) { return { c: r[0], t: norm(caminho('ncm', r[0]).map(function (x) { return x[1]; }).join(' ')) }; });
        folhasNbs = NBS.filter(function (r) { return r[0].length === 9; }).map(function (r) {
          var sug = DATA.nbsSug[r[0]];
          return { c: r[0], t: norm(caminho('nbs', r[0]).map(function (x) { return x[1]; }).join(' ')), lc: sug ? sug.lc : [] };
        });
      })
      .catch(function () { $('#n-msg').textContent = 'Não foi possível carregar as tabelas de NCM/NBS. Recarregue a página.'; });
    return carregandoNom;
  }
  function caminho(tipo, c) {
    var mapa = tipo === 'ncm' ? ncmMapa : nbsMapa, lens = tipo === 'ncm' ? [2, 4, 5, 6, 7, 8] : [1, 3, 5, 6, 7, 8, 9], out = [];
    lens.forEach(function (n) { var p = c.slice(0, n); if (p.length === n && mapa[p] && (!out.length || out[out.length - 1][0] !== p)) out.push([p, mapa[p]]); });
    return out;
  }
  function buscar(tipo, q) {
    q = q.trim(); if (!q) return [];
    var lista = tipo === 'ncm' ? folhasNcm : folhasNbs; if (!lista) return [];
    var dig = q.replace(/[.\-\s]/g, '');
    var res = [];
    if (tipo === 'nbs' && /^\d{1,2}[.,]\d{1,2}$/.test(q)) { // item da lista da LC 116 (ex.: 17.19)
      var item = q.split(/[.,]/); var alvo = String(Number(item[0])) + '.' + item[1].padStart(2, '0');
      lista.forEach(function (x) { if (res.length < 60 && x.lc.indexOf(alvo) >= 0) res.push(x.c); });
    } else if (/^\d+$/.test(dig)) {
      for (var i = 0; i < lista.length && res.length < 40; i++) if (lista[i].c.indexOf(dig) === 0) res.push(lista[i].c);
    } else {
      var termos = norm(q).split(/\s+/).filter(Boolean);
      for (var j = 0; j < lista.length && res.length < 40; j++) {
        var t = lista[j].t; if (termos.every(function (w) { return t.indexOf(w) >= 0; })) res.push(lista[j].c);
      }
    }
    return res;
  }
  function descFolha(tipo, c) { var m = tipo === 'ncm' ? ncmMapa : nbsMapa; return m[c] || ''; }

  function toggleNota() {
    var reg = $('#n-regime').value, tipo = $('#n-tipo').value;
    var sn = reg === 'SN';
    $('.only-sn-n').hidden = !sn;
    $$('#f-nota .only-reg-n').forEach(function (e) { e.hidden = sn; });
    $('#n-vals-ncm').hidden = tipo !== 'ncm'; $('#n-vals-nbs').hidden = tipo !== 'nbs';
    $('#n-cod-lbl').textContent = tipo === 'ncm' ? 'NCM do produto' : 'NBS do serviço';
    $('#n-cod').placeholder = tipo === 'ncm' ? 'Digite o código ou a descrição (ex.: 10063021 ou arroz)' : 'Digite a NBS, a descrição (ex.: contabilidade) ou o item da LC 116 (ex.: 17.19)';
    $('#n-cod-hint').textContent = tipo === 'ncm' ? 'Use os 8 dígitos do NCM ou busque pela descrição.' : 'A NFS-e usa a NBS (9 dígitos), não o CNAE. Busque pela descrição do serviço ou pelo item da LC 116.';
  }
  function limparCodigo() { codSel = null; enqAtual = null; $('#n-enq').hidden = true; $('#n-path').innerHTML = ''; $('#n-class').innerHTML = '<option value="">Informe o NCM/NBS para listar as classificações aplicáveis</option>'; $('#n-class-hint').textContent = ''; $('#n-is-f').hidden = true; }

  function escolherCodigo(c) {
    var tipo = $('#n-tipo').value;
    codSel = { tipo: tipo, c: c };
    $('#n-cod').value = (tipo === 'ncm' ? fmtNcm(c) : fmtNbs(c)) + ' — ' + descFolha(tipo, c);
    $('#n-sugg').hidden = true;
    $('#n-path').innerHTML = caminho(tipo, c).map(function (x) { return '<b>' + esc(tipo === 'ncm' ? fmtNcm(x[0]) : x[0]) + '</b> ' + esc(x[1]); }).join('<br>');
    var enq = enquadrar(tipo, c);
    var opt = function (x) { return '<option value="' + x.c + '">' + x.cst + ' / ' + x.c + ' — ' + esc(x.d.length > 110 ? x.d.slice(0, 107) + '…' : x.d) + rotRed(x) + '</option>'; };
    var h = '<optgroup label="Regra geral">' + opt(enq.integral) + '</optgroup>';
    if (enq.especificas.length) h += '<optgroup label="Tratamentos da LC 214/2025 vinculados a este código">' + enq.especificas.map(opt).join('') + '</optgroup>';
    h += '<optgroup label="Outras situações (confirme o enquadramento)">' + enq.outras.map(opt).join('') + '</optgroup>';
    $('#n-class').innerHTML = h;
    $('#n-class').value = enq.escolhida.c;
    var hint = enq.especificas.length > 1 ? 'Este código também consta de: ' + enq.especificas.filter(function (x) { return x !== enq.escolhida; }).map(function (x) { return x.c + rotRed(x); }).join('; ') + '. Troque a classificação se a operação se enquadrar em outra hipótese.' : '';
    if (enq.lc.length) hint += (hint ? ' ' : '') + 'Item(ns) da LC 116 correlacionado(s): ' + enq.lc.join(', ') + '.';
    $('#n-class-hint').textContent = hint;
    mostrarEnquadramento(enq);
    $('#n-is-f').hidden = !(tipo === 'ncm' && R.sujeitoIS(IDX, c));
  }
  // Beneficios que dependem de condicao do adquirente ou da operacao nao sao aplicados automaticamente.
  var CONDICIONAL = /administra[cç][aã]o p[uú]blica|[oó]rg[aã]os|entidades de sa[uú]de imunes|emerg[eê]ncia|soberania|diferimento|produtor rural|Programa Universidade|Institui[cç][aã]o Cient[ií]fica|cooperativ|zonas reabilitadas|reabilita[cç][aã]o urbana|projetos incentivados|Zona Franca|livre com[eé]rcio/i;
  function reducaoMedia(x) { var r = x.red || {}; return (Number(r.cbs || 0) + Number(r.ibsUf || 0) + Number(r.ibsMun || 0)) / 3; }
  function enquadrar(tipo, c) {
    var ap = R.classificacoesPara(IDX, tipo, c);
    var sug = tipo === 'nbs' && DATA.nbsSug[c] ? DATA.nbsSug[c] : null;
    var esp = ap.especificas.slice();
    if (sug) sug.c.forEach(function (cc) { var o = IDX.porCodigo[cc]; if (o && cc !== '000001' && esp.indexOf(o) < 0 && ap.gerais.indexOf(o) >= 0) esp.push(o); });
    var integral = IDX.porCodigo['000001'];
    // candidatos automaticos: anexo da LC 214 (NCM/NBS) ou correlacao oficial NBS -> cClassTrib
    var cand = esp.filter(function (x) { return !CONDICIONAL.test(x.d) && !x.dif && x.gIBSCBS; });
    if (sug && sug.c.indexOf('000001') >= 0) cand = cand.filter(function (x) { return ap.especificas.indexOf(x) >= 0; }); // NBS com tributacao integral prevista
    cand.sort(function (a, b) { return reducaoMedia(b) - reducaoMedia(a); });
    var escolhida = cand[0] || integral;
    var outras = ap.gerais.filter(function (x) { return x.c !== '000001' && esp.indexOf(x) < 0; });
    var motivo;
    if (escolhida === integral) motivo = esp.length ? 'Os tratamentos vinculados a este código dependem de condições específicas (ex.: venda a órgão público, diferimento). Aplicada a tributação integral — altere se a operação se enquadrar.' : 'Nenhuma redução ou isenção vinculada a este código nas tabelas oficiais da Receita.';
    else if (ap.especificas.indexOf(escolhida) >= 0) motivo = 'O código consta do anexo da LC 214/2025 vinculado a esta classificação nas tabelas oficiais da Receita.';
    else motivo = 'Classificação indicada pela correlação oficial NBS × LC 116 × cClassTrib da NFS-e.';
    return { integral: integral, especificas: esp, outras: outras, escolhida: escolhida, motivo: motivo, lc: sug ? sug.lc : [] };
  }
  function rotuloTratamento(x) {
    if (!x.gIBSCBS) return { t: 'Sem incidência de CBS/IBS', cls: 'g' };
    if (x.dif) return { t: 'Diferimento', cls: '' };
    var m = reducaoMedia(x);
    if (m >= 100) return { t: 'Alíquota zero — redução de 100%', cls: 'g' };
    if (m > 0) { var r = x.red; return { t: Number(r.cbs) === Number(r.ibsUf) ? 'Redução de ' + numBR(r.cbs) + '%' : 'Redução CBS ' + numBR(r.cbs) + '% · IBS ' + numBR(r.ibsUf) + '%', cls: 'g' }; }
    return { t: 'Tributação integral', cls: 'n' };
  }
  var enqAtual = null;
  function mostrarEnquadramento(enq) {
    var x = IDX.porCodigo[$('#n-class').value] || enq.escolhida, rt = rotuloTratamento(x);
    var manual = x !== enq.escolhida;
    $('#n-enq').innerHTML = '<div class="box ' + (rt.cls === 'g' ? 'ok' : 'plain') + '" style="margin:10px 0 0"><h2><span class="ic">' + (rt.cls === 'g' ? '✅' : 'ℹ️') + '</span>Enquadramento ' + (manual ? 'selecionado' : 'identificado') + ': ' + esc(rt.t) + '</h2>' +
      '<p><span class="tag ' + (rt.cls === 'g' ? 'g' : 'n') + '">CST ' + x.cst + ' · cClassTrib ' + x.c + '</span> ' + esc(x.d) + '</p>' +
      '<p style="font-size:12.5px;color:var(--ink3)">' + esc(manual ? 'Classificação alterada manualmente.' : enq.motivo) + '</p></div>';
    $('#n-enq').hidden = false;
    enqAtual = enq;
  }

  function rotRed(x) {
    if (!x.gIBSCBS) return ' [sem destaque de CBS/IBS]';
    if (x.dif) return ' [diferimento]';
    var r = x.red || {}; var c = Number(r.cbs || 0), u = Number(r.ibsUf || 0);
    if (c === 0 && u === 0) return '';
    if (c === u) return ' [redução de ' + numBR(c) + '%]';
    return ' [redução CBS ' + numBR(c) + '% · IBS ' + numBR(u) + '%]';
  }

  function eventosNota() {
    var inp = $('#n-cod'), box = $('#n-sugg'), ativo = -1, timer = null;
    function mostrar(lista) {
      var tipo = $('#n-tipo').value;
      if (!lista.length) { box.innerHTML = '<button type="button" disabled>Nenhum código encontrado</button>'; box.hidden = false; return; }
      box.innerHTML = lista.map(function (c, i) { return '<button type="button" role="option" data-c="' + c + '"><b>' + esc(tipo === 'ncm' ? fmtNcm(c) : fmtNbs(c)) + '</b>' + esc(rotuloCurto(tipo, c)) + '</button>'; }).join('');
      box.hidden = false; ativo = -1;
    }
    inp.addEventListener('input', function () {
      limparCodigo();
      clearTimeout(timer);
      if (!folhasNcm && inp.value.trim().length >= 2) { box.innerHTML = '<button type="button" disabled>Carregando tabelas de NCM/NBS…</button>'; box.hidden = false; }
      timer = setTimeout(function () {
        carregaNomenclaturas().then(function () {
          var tipo = $('#n-tipo').value, q = inp.value, dig = q.replace(/[.\-\s]/g, '');
          if (tipo === 'ncm' && /^\d{8}$/.test(dig) && ncmMapa[dig]) { escolherCodigo(dig); return; }
          if (tipo === 'nbs' && /^\d{9}$/.test(dig) && nbsMapa[dig]) { escolherCodigo(dig); return; }
          if (q.trim().length < 2) { box.hidden = true; return; }
          mostrar(buscar(tipo, q));
        });
      }, 160);
    });
    inp.addEventListener('keydown', function (ev) {
      var bs = $$('button[data-c]', box); if (box.hidden || !bs.length) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); ativo = (ativo + (ev.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length; bs.forEach(function (b, i) { b.classList.toggle('on', i === ativo); }); bs[ativo].scrollIntoView({ block: 'nearest' }); }
      else if (ev.key === 'Enter') { ev.preventDefault(); escolherCodigo((bs[ativo] || bs[0]).dataset.c); }
      else if (ev.key === 'Escape') box.hidden = true;
    });
    box.addEventListener('mousedown', function (ev) { var b = ev.target.closest('button[data-c]'); if (b) { ev.preventDefault(); escolherCodigo(b.dataset.c); } });
    inp.addEventListener('blur', function () { setTimeout(function () { box.hidden = true; }, 150); });
    $('#n-tipo').addEventListener('change', function () { toggleNota(); inp.value = ''; limparCodigo(); $('#n-res').hidden = true; });
    $('#n-regime').addEventListener('change', function () { toggleNota(); $('#n-res').hidden = true; });
    $('#f-nota').addEventListener('reset', function () { setTimeout(function () { limparCodigo(); toggleNota(); $('#n-res').hidden = true; $('#n-msg').textContent = ''; }, 0); });
    $('#f-nota').addEventListener('submit', calcularNota);
    $('#n-class').addEventListener('change', function () {
      if (enqAtual) mostrarEnquadramento(enqAtual);
      if (!$('#n-res').hidden) calcularNota({ preventDefault: function () { } });
    });
  }
  function rotuloCurto(tipo, c) {
    var p = caminho(tipo, c); var folha = p.length ? p[p.length - 1][1] : '';
    var pai = p.length > 1 ? p[p.length - 2][1] : '';
    var t = /^[-\s]*outr[oa]s?\.?$/i.test(folha.trim()) || folha.length < 25 ? (pai ? pai.replace(/^[-\s]+/, '') + ' › ' : '') + folha : folha;
    return t.length > 150 ? t.slice(0, 147) + '…' : t;
  }

  function lerValor(id) { var el = $(id); var r = parseNum(el.value, ehPct(el)); el.setAttribute('aria-invalid', String(!r.ok)); if (!r.ok) throw el; return r.v; }

  function calcularNota(ev) {
    ev.preventDefault();
    var msg = $('#n-msg'); msg.textContent = '';
    if (!codSel) { msg.textContent = 'Selecione um ' + ($('#n-tipo').value === 'ncm' ? 'NCM' : 'NBS') + ' da lista.'; $('#n-cod').focus(); return; }
    var reg = $('#n-regime').value, tipo = codSel.tipo, p = premissas();
    var v = {};
    try {
      if (tipo === 'ncm') ['vprod', 'vfrete', 'vseg', 'voutro', 'vdesc', 'vicms', 'vis'].forEach(function (k) { v[k] = lerValor('#n-' + k); });
      else ['vserv', 'sdesc', 'sded', 'siss'].forEach(function (k) { v[k] = lerValor('#n-' + k); });
      if (reg === 'SN') ['rbt12', 'pcbs', 'pibs'].forEach(function (k) { v[k] = lerValor('#n-' + k); });
    } catch (el) { msg.textContent = 'Valor inválido em "' + el.closest('.field').querySelector('label').textContent + '".'; el.focus(); return; }
    var valorOp = tipo === 'ncm' ? v.vprod : v.vserv;
    if (!(Number(valorOp) > 0)) { msg.textContent = 'Informe o valor ' + (tipo === 'ncm' ? 'dos produtos.' : 'do serviço.'); $(tipo === 'ncm' ? '#n-vprod' : '#n-vserv').focus(); return; }
    if ($('#n-is-f').hidden) v.vis = '0';
    var out = { tipo: tipo, cod: codSel.c, reg: reg };
    if (reg === 'SN') {
      var base = tipo === 'ncm' ? R.baseSimplesNFe({ vProd: v.vprod, vFrete: v.vfrete, vSeg: v.vseg, vOutro: v.voutro, vDesc: v.vdesc, vIS: v.vis })
        : (function () { var b = R.D(v.vserv) - R.D(v.sdesc) - R.D(v.sded); return b < 0n ? 0n : b; })();
      var s = R.simplesAliquotas($('#n-anexo').value, Number(v.rbt12) > 0 ? v.rbt12 : 1);
      var semRbt = !(Number(v.rbt12) > 0);
      if (Number(v.pcbs) > 0 || Number(v.pibs) > 0) { s.pCBSSN = R.D(v.pcbs); s.pIBSSN = R.D(v.pibs); s.informadoPgdas = true; semRbt = false; }
      out.simples = s; out.semRbt = semRbt;
      out.item = R.calcularItemSimples(base, s.pCBSSN, s.pIBSSN, tipo === 'nbs' ? 2 : null);
    } else {
      var cls = IDX.porCodigo[$('#n-class').value] || IDX.porCodigo['000001'];
      var bc = tipo === 'ncm' ? R.baseNFe({ vProd: v.vprod, vFrete: v.vfrete, vSeg: v.vseg, vOutro: v.voutro, vDesc: v.vdesc, vICMS: v.vicms, vIS: v.vis })
        : R.baseNFSe({ valorServico: v.vserv, descontoIncondicional: v.sdesc, vCalcReeRepRes: v.sded, iss: v.siss });
      out.cls = cls; out.item = R.calcularItemRegular(bc, cls, p);
    }
    out.v = v; out.valorOp = tipo === 'ncm' ? R.D(v.vprod) + R.D(v.vfrete) + R.D(v.vseg) + R.D(v.voutro) - R.D(v.vdesc) : R.D(v.vserv) - R.D(v.sdesc);
    renderNota(out, p);
  }

  function renderNota(o, p) {
    var el = $('#n-res'), it = o.item, h = '';
    var codTxt = (o.tipo === 'ncm' ? 'NCM ' + fmtNcm(o.cod) : 'NBS ' + fmtNbs(o.cod));
    h += '<h2 class="sec">Resultado da nota <span class="cnt">' + esc(codTxt) + '</span></h2>';
    var cbs, ibs, tot;
    if (o.reg === 'SN') { cbs = it.vCBS; ibs = it.vIBS; tot = it.total; }
    else { cbs = it.vCBS; ibs = it.vIBS; tot = it.total; }
    var carga = o.valorOp > 0n ? R.dec.div(R.dec.mul(tot, R.D(100)), o.valorOp) : 0n;
    h += '<div class="counts">' +
      '<div class="ct"><div class="n">' + brl(cbs) + '</div><div class="l">CBS da nota</div></div>' +
      '<div class="ct b"><div class="n">' + brl(ibs) + '</div><div class="l">IBS da nota (estadual + municipal)</div></div>' +
      '<div class="ct a"><div class="n">' + brl(tot) + '</div><div class="l">Total CBS + IBS</div></div>' +
      '<div class="ct c"><div class="n">' + pct(carga, 2) + '</div><div class="l">Sobre o valor da operação (' + brl(o.valorOp) + ')</div></div></div>';
    h += '<div class="tbl-wrap"><table><thead><tr><th>Tributo</th><th class="v">Base de cálculo</th><th class="v">Alíquota</th><th class="v">Redução</th><th class="v">Alíquota efetiva</th><th class="v">Valor</th></tr></thead><tbody>';
    if (o.reg === 'SN') {
      h += '<tr><td>CBS (Simples Nacional)</td><td class="v">' + brl(it.vBC) + '</td><td class="v">' + pct(it.pCBSSN, 4) + '</td><td class="v">—</td><td class="v">' + pct(it.pCBSSN, 4) + '</td><td class="v">' + brl(it.vCBS) + '</td></tr>';
      h += '<tr><td>IBS (Simples Nacional)</td><td class="v">' + brl(it.vBC) + '</td><td class="v">' + pct(it.pIBSSN, 4) + '</td><td class="v">—</td><td class="v">' + pct(it.pIBSSN, 4) + '</td><td class="v">' + brl(it.vIBS) + '</td></tr>';
    } else {
      ['cbs', 'ibsUf', 'ibsMun'].forEach(function (k) {
        var t = it.tributos[k];
        h += '<tr><td>' + t.nome + '</td><td class="v">' + brl(it.vBC) + '</td><td class="v">' + pct(t.aliquota, 4) + '</td><td class="v">' + pct(t.pRed, 2) + '</td><td class="v">' + pct(t.aliquotaEfetiva, 4) + '</td><td class="v">' + brl(t.devido) + (t.diferido > 0n ? ' <span class="bdg">diferido ' + brl(t.diferido) + '</span>' : '') + '</td></tr>';
      });
    }
    h += '<tr class="tot"><td colspan="5">Total de CBS + IBS</td><td class="v">' + brl(tot) + '</td></tr></tbody></table></div>';

    h += '<div class="box plain"><h2>Dados para a nota fiscal</h2><ul>';
    h += '<li><strong>' + esc(codTxt) + '</strong> — ' + esc(descFolha(o.tipo, o.cod)) + '</li>';
    if (o.reg === 'SN') {
      var s = o.simples;
      h += '<li>Emitente do Simples Nacional (CBS/IBS no DAS). ' + (s.informadoPgdas ? 'Alíquotas informadas do PGDAS.' : esc(s.anexoNome) + ', ' + s.faixa + 'ª faixa — alíquota efetiva do DAS ' + pct(s.aliquotaEfetiva, 4) + '; partilha 2027: CBS ' + pct(s.repCBS, 2) + ' / IBS ' + pct(s.repIBS, 2) + '.') + '</li>';
      if (o.semRbt) h += '<li><strong>RBT12 não informada:</strong> foi usada a 1ª faixa do anexo. Informe a RBT12 para um cálculo mais preciso.</li>';
      h += '<li>Crédito para o adquirente do regime regular: limitado ao valor de CBS/IBS efetivamente recolhido pelo Simples — <strong>' + brl(tot) + '</strong>.</li>';
    } else {
      var c = o.cls;
      h += '<li>CST <strong>' + c.cst + '</strong> (' + esc(c.cstDesc) + ') · cClassTrib <strong>' + c.c + '</strong> — ' + esc(c.d) + '</li>';
      h += '<li>Base de cálculo: ' + (o.tipo === 'ncm' ? 'produtos + frete + seguro + outras despesas + IS − desconto − ICMS/FCP' : 'serviço − desconto incondicional − reembolsos/deduções − ISS') + ' = <strong>' + brl(it.vBC) + '</strong>' + (c.baseFator !== 1 ? ' (tratamento com redução de base: fator ' + numBR(c.baseFator) + ')' : '') + '.</li>';
      if (it.semDestaque) h += '<li>Situação sem destaque de CBS/IBS no documento (CST ' + c.cst + ').</li>';
      if (it.diferido) h += '<li>Operação com diferimento: o imposto é calculado e integralmente diferido.</li>';
      h += '<li>Crédito para o adquirente do regime regular: ' + (c.cred && it.total > 0n ? '<strong>' + brl(it.total) + '</strong> (apropriação admitida para esta classificação).' : 'não há crédito apropriável nesta classificação.') + '</li>';
      if (o.reg === 'SNH') h += '<li>Emitente do Simples optante pelo regime regular: destaca CBS/IBS como no regime regular.</li>';
    }
    h += '</ul></div>';
    h += '<div class="disc">Simulação aproximada pelas regras da Calculadora RTC da Receita Federal, com ' + esc(aliqTexto(p)) + '. O enquadramento (NCM/NBS, CST e cClassTrib) é de responsabilidade do emitente e depende da veracidade das informações.</div>';
    h += '<div class="btns no-print"><button class="btn sec" type="button" onclick="window.print()">Imprimir / salvar PDF</button></div>';
    el.innerHTML = h; el.hidden = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ================================================================== premissas
  function eventosPremissas() {
    $('#f-prem').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var m = $('#pr-msg'), ids = { cbs: '#pr-cbs', ibsUf: '#pr-uf', ibsMun: '#pr-mun' }, p = {};
      for (var k in ids) {
        var r = parseNum($(ids[k]).value, true);
        if (!r.ok || r.vazio || Number(r.v) < 0 || Number(r.v) > 100) { m.style.color = 'var(--red)'; m.textContent = 'Alíquota inválida.'; $(ids[k]).focus(); return; }
        p[k] = Number(r.v);
      }
      store.set('rtcg-premissas', p); atualizaMeta(); renderPainel();
      m.style.color = 'var(--green-dk)'; m.textContent = 'Premissas salvas: ' + aliqTexto(premissas()) + '.';
    });
    $('#pr-reset').addEventListener('click', function () {
      try { localStorage.removeItem('rtcg-premissas'); } catch (e) { }
      atualizaMeta(); renderPainel(); $('#pr-msg').style.color = 'var(--green-dk)'; $('#pr-msg').textContent = 'Premissas padrão restauradas.';
    });
  }

  // ================================================================== inicializacao
  function init() {
    document.addEventListener('focusout', function (ev) { var el = ev.target; if (el && el.matches && el.matches('input.num')) formatarCampo(el); });
    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { abrir(t.id.slice(2)); }); });
    window.addEventListener('hashchange', function () { abrir(tabDoHash(), false); });
    fetch('data/rtc.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      DATA = d; IDX = R.criarIndice(d);
      var dt = String(d.meta.dataBase || '').slice(0, 10).split('-').reverse().join('/');
      $('#meta-base').textContent = 'Versão ' + d.meta.versaoBase + ' (' + dt + ')';
      $('#meta-base2').textContent = 'versão ' + d.meta.versaoBase + ', de ' + dt + ', vigência em ' + d.meta.dataReferencia.split('-').reverse().join('/');
      atualizaMeta();
      opcoesAnexo($('#s-anexo')); opcoesAnexo($('#n-anexo'));
      montaFaixas();
      $('#s-regime').addEventListener('change', toggleSim); toggleSim();
      $('#f-sim').addEventListener('submit', simular);
      $('#f-sim').addEventListener('reset', function () { setTimeout(function () { toggleSim(); totalFaixas(); $('#s-res').hidden = true; $('#s-msg').textContent = ''; }, 0); });
      linhas = store.get('rtcg-painel', []) || [];
      eventosPainel(); renderPainel();
      eventosNota(); toggleNota();
      eventosPremissas();
      $('#loading').remove();
      abrir(tabDoHash(), false);
      setTimeout(carregaNomenclaturas, 800);
    }).catch(function () {
      $('#loading').textContent = 'Não foi possível carregar as tabelas da calculadora. Verifique sua conexão e recarregue a página.';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
