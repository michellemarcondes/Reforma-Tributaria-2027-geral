/* Aba "Crédito de estoque": leitura dos XMLs no navegador e cálculo do crédito presumido de CBS (art. 381 da LC 214/2025). */
(function () {
  'use strict';
  var E = window.ESTOQUE;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var nf = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function brl(v) { return nf.format(Number(E.toStr(v, 2))); }
  function qtd(v) { return E.toNum(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  // mesmo criterio do restante do site: aceita 1.500 / 1500 / 1.500,25 / 1500.25
  function num(s, pct) {
    s = String(s == null ? '' : s).trim().replace(/\s|R\$|%/g, '');
    if (!s) return { ok: true, v: '0', vazio: true };
    var v = s.indexOf(','), p = s.indexOf('.');
    if (v >= 0 && p >= 0) s = s.lastIndexOf('.') > s.lastIndexOf(',') ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    else if (v >= 0) s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
    else if (p >= 0) { var pp = s.split('.'); if (pp.length > 2) s = s.replace(/\./g, ''); else if (!pct && pp[1].length === 3 && /^[1-9]\d{0,2}$/.test(pp[0])) s = pp[0] + pp[1]; }
    return /^\d+(\.\d+)?$/.test(s) ? { ok: true, v: s } : { ok: false, v: '0' };
  }
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  var st = { lidas: [], arquivos: 0, erros: [], ajustes: {}, res: null, tot: null, filtro: 'todos', busca: '', limite: 300, ocupado: false };

  function param() {
    var a = num($('#e-aliq').value, true);
    return { aliquota: a.ok && !a.vazio ? a.v : '9.25', regime: $('#e-regime').value, excluirIcms: $('#e-icms').checked, incluirIpi: $('#e-ipi').checked, incluirSt: $('#e-st').checked, incluirRevisar: $('#e-rev').checked };
  }

  // ---------------------------------------------------------------- leitura dos arquivos
  function pausa() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function progresso(feitos, total, txt) {
    $('#e-prog').hidden = false;
    $('#e-bar').style.width = (total ? Math.round(feitos * 100 / total) : 0) + '%';
    $('#e-prog-txt').textContent = txt;
  }
  async function lerArquivos(lista) {
    if (st.ocupado) return;
    var files = Array.prototype.slice.call(lista || []).filter(function (f) { return /\.(xml|zip)$/i.test(f.name); });
    if (!files.length) { $('#e-msg').textContent = 'Nenhum arquivo .xml ou .zip encontrado na seleção.'; return; }
    st.ocupado = true; $('#e-msg').textContent = '';
    var feitos = 0, total = files.length, novos = 0;
    try {
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        try {
          var bytes = new Uint8Array(await f.arrayBuffer());
          if (/\.zip$/i.test(f.name)) {
            var ents = E.listarZip(bytes).filter(function (z) { return /\.xml$/i.test(z.nome) && !/(^|\/)__MACOSX\//.test(z.nome); });
            total += ents.length;
            for (var k = 0; k < ents.length; k++) {
              try { st.lidas.push(E.lerXml(E.decodificarXml(await ents[k].ler()), f.name + ' › ' + ents[k].nome)); novos++; }
              catch (e2) { st.erros.push({ arquivo: f.name + ' › ' + ents[k].nome, motivo: 'não foi possível ler (' + e2.message + ')' }); }
              feitos++; st.arquivos++;
              if (feitos % 50 === 0) { progresso(feitos, total, 'Lendo ' + feitos + ' de ' + total + ' arquivos…'); await pausa(); }
            }
          } else {
            st.lidas.push(E.lerXml(E.decodificarXml(bytes), f.webkitRelativePath || f.name)); novos++; st.arquivos++;
          }
        } catch (e) { st.erros.push({ arquivo: f.name, motivo: 'não foi possível ler (' + e.message + ')' }); }
        feitos++;
        if (feitos % 50 === 0) { progresso(feitos, total, 'Lendo ' + feitos + ' de ' + total + ' arquivos…'); await pausa(); }
      }
      progresso(total, total, novos + ' XML(s) lidos nesta seleção.');
    } finally { st.ocupado = false; }
    recalcular(true);
  }

  // ---------------------------------------------------------------- calculo
  function recalcular(detectar) {
    if (!st.lidas.length) { $('#e-res').hidden = true; $('#e-inv-card').hidden = true; $('#e-lidos').textContent = ''; return; }
    var cnpj = $('#e-cnpj').value.replace(/\D/g, '');
    st.res = E.consolidar(st.lidas, param(), detectar && !$('#e-cnpj').dataset.manual ? '' : cnpj);
    if (!$('#e-cnpj').dataset.manual) $('#e-cnpj').value = formatarCnpj(st.res.cnpjEmpresa);
    if (!$('#e-nome').dataset.manual && st.res.nomeEmpresa) $('#e-nome').value = st.res.nomeEmpresa;
    st.res.produtos.forEach(function (p) {
      var a = st.ajustes[p.id];
      if (a) { if (a.qEstoque !== undefined) p.qEstoque = a.qEstoque; if (a.incluir !== undefined && p.situacao !== 'nao') p.incluir = a.incluir; }
      if (p.situacao === 'nao') p.incluir = false;
    });
    var r = st.res.resumo;
    $('#e-lidos').innerHTML = '<strong>' + st.arquivos + '</strong> arquivo(s) lido(s) · <strong>' + r.notasValidas + '</strong> nota(s) de compra válidas · ' +
      r.canceladas + ' cancelada(s) · ' + r.duplicadas + ' duplicada(s) · ' + r.saidasProprias + ' venda(s) da própria empresa ignorada(s)' +
      ((st.res.ignoradas.length + st.erros.length) ? ' · ' + (st.res.ignoradas.length + st.erros.length) + ' arquivo(s) não aproveitado(s)' : '');
    $('#e-inv-card').hidden = false;
    renderTudo();
  }
  function formatarCnpj(c) { c = String(c || ''); return c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : c; }
  function totais() {
    var o = num($('#e-outros').value);
    st.tot = E.totalizar(st.res.produtos, param(), o.ok ? o.v : '0');
    return st.tot;
  }

  // ---------------------------------------------------------------- renderizacao
  function renderTudo() {
    var el = $('#e-res');
    el.innerHTML = '<div id="e-sum"></div>' +
      '<h3 class="sub">Produtos das notas <span class="nome" id="e-cnt-prod" style="font-weight:400;color:var(--ink3)"></span></h3>' +
      '<div class="tools no-print"><input id="e-busca" placeholder="Buscar por código, descrição, NCM ou fornecedor" aria-label="Buscar produtos">' +
      '<div class="fbtns" role="group" aria-label="Filtrar por situação">' +
      [['todos', 'Todos'], ['elegivel', 'Elegíveis'], ['revisar', 'Em revisão'], ['nao', 'Sem crédito']].map(function (b) { return '<button class="fb" type="button" data-f="' + b[0] + '" aria-pressed="' + (st.filtro === b[0]) + '">' + b[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="tbl-wrap"><table class="edit" id="e-tab"><thead><tr><th>Situação</th><th>Produto</th><th>NCM</th><th>Fornecedor</th><th>CFOP</th><th class="v">Qtd comprada</th><th class="v">Custo unit.</th><th class="v">Qtd em estoque</th><th class="v">Valor do estoque</th><th class="v">Crédito</th><th>Somar</th></tr></thead><tbody></tbody></table></div>' +
      '<div class="btns no-print" id="e-mais-w"></div>' +
      '<div id="e-ign"></div>' +
      '<div class="btns no-print"><button class="btn sec" type="button" id="e-csv">Exportar memória de cálculo (CSV)</button><button class="btn sec" type="button" onclick="window.print()">Imprimir / salvar PDF</button></div>';
    el.hidden = false;
    $('#e-busca').value = st.busca;
    renderResumo(); renderTabela(); renderIgnorados();
  }

  function renderResumo() {
    var t = totais(), mes = Number($('#e-mes').value), cr = E.cronograma(t.credito, mes, 2027);
    var nm = $('#e-nome').value.trim();
    var nEle = 0, nRev = 0, nNao = 0;
    st.res.produtos.forEach(function (p) { if (p.situacao === 'elegivel') nEle++; else if (p.situacao === 'revisar') nRev++; else nNao++; });
    var h = '<h2 class="sec">Resultado' + (nm ? ' — ' + esc(nm) : '') + ' <span class="cnt">estoque em 1º/01/2027</span></h2>';
    h += '<div class="counts">' +
      '<div class="ct a"><div class="n">' + brl(t.credito) + '</div><div class="l">Crédito presumido de CBS (total)</div></div>' +
      '<div class="ct b"><div class="n">' + brl(cr[0] ? cr[0].valor : 0n) + '</div><div class="l">Parcela mensal (12×), a partir de ' + MESES[mes - 1] + '/2027</div></div>' +
      '<div class="ct"><div class="n">' + brl(t.base + t.baseImp) + '</div><div class="l">Valor do estoque considerado (custo de aquisição)</div></div>' +
      '<div class="ct c"><div class="n">' + nEle + ' / ' + nRev + ' / ' + nNao + '</div><div class="l">Produtos elegíveis / em revisão / sem crédito</div></div></div>';
    if (t.potencialRevisar > 0n) h += '<div class="box alert"><h2><span class="ic">🔎</span>Itens em revisão</h2><p>Há <strong>' + brl(t.potencialRevisar) + '</strong> de crédito potencial em itens em revisão (fornecedor do Simples Nacional ou CFOP atípico) que <strong>não foram somados</strong>. Confirme cada caso e marque “Somar” na tabela, ou ative a opção nas premissas.</p></div>';
    if ($('#e-regime').value === 'LR') h += '<div class="box plain"><p>Lucro Real: o crédito presumido alcança apenas os bens adquiridos com PIS/Cofins monofásico ou por substituição tributária (CST 04/05 nas notas). Os demais já geraram crédito de PIS/Cofins no regime não cumulativo.</p></div>';

    h += '<h3 class="sub">Composição do crédito</h3><div class="tbl-wrap"><table class="mem"><tbody>' +
      '<tr><td>Estoque elegível adquirido no mercado interno (custo de aquisição)</td><td class="v">' + brl(t.base - t.outrosBase) + '</td></tr>' +
      (t.outrosBase > 0n ? '<tr><td>Outros estoques sem XML informados</td><td class="v">' + brl(t.outrosBase) + '</td></tr>' : '') +
      '<tr><td>Crédito sobre o estoque nacional (× ' + esc(E.toNum(E.D(param().aliquota)).toLocaleString('pt-BR')) + '%)</td><td class="v">' + brl(t.credito - t.creditoImp) + '</td></tr>' +
      (t.baseImp > 0n ? '<tr><td>Bens importados — PIS/Cofins-Importação pagos (estoque de ' + brl(t.baseImp) + ')</td><td class="v">' + brl(t.creditoImp) + '</td></tr>' : '') +
      '<tr class="tot"><td>Crédito presumido total</td><td class="v">' + brl(t.credito) + '</td></tr>' +
      '<tr><td>Estoque sem direito a crédito (alíquota zero, isento, imobilizado, uso e consumo, transferências…)</td><td class="v">' + brl(t.nao) + '</td></tr>' +
      '</tbody></table></div>';

    h += '<h3 class="sub">Cronograma de apropriação — 12 parcelas iguais</h3><div class="tbl-wrap"><table><thead><tr><th>Parcela</th><th>Mês</th><th class="v">Valor a abater da CBS</th><th class="v">Saldo a apropriar</th></tr></thead><tbody>' +
      cr.map(function (c) { return '<tr><td>' + c.n + 'ª</td><td>' + MESES[c.mes - 1] + '/' + c.ano + '</td><td class="v">' + brl(c.valor) + '</td><td class="v">' + brl(c.saldo) + '</td></tr>'; }).join('') +
      '<tr class="tot"><td colspan="2">Total</td><td class="v">' + brl(t.credito) + '</td><td></td></tr></tbody></table></div>';

    h += '<div class="box ok"><h2><span class="ic">🧭</span>Como fazer na prática</h2><ol class="passos">' +
      '<li><strong>Até 31/12/2026 — levante o inventário:</strong> conte fisicamente o estoque e valorize cada item pelo custo de aquisição. Ele deve bater com o Bloco H (inventário) da EFD ICMS/IPI e com a contabilidade.</li>' +
      '<li><strong>Separe as notas de compra</strong> dos itens que ficaram em estoque e confira a tabela acima: só entram bens adquiridos de pessoa jurídica para revenda ou produção. Ficam fora os bens adquiridos com alíquota zero, isenção ou suspensão, além de uso e consumo, imobilizado, transferências e bens de terceiros.</li>' +
      '<li><strong>Calcule o crédito:</strong> 9,25% sobre o custo do estoque elegível (nos importados, o PIS/Cofins-Importação pago) — total de <strong>' + brl(t.credito) + '</strong>.</li>' +
      '<li><strong>Até 30/06/2027 — aproprie o crédito</strong>, informando o inventário na forma prevista na regulamentação (Decreto nº 12.955/2026, arts. 605 a 613).</li>' +
      '<li><strong>Use em 12 parcelas mensais de ' + brl(cr[0] ? cr[0].valor : 0n) + '</strong>, de ' + MESES[mes - 1] + '/2027 a ' + MESES[cr[11].mes - 1] + '/' + cr[11].ano + ', abatendo somente a CBS devida — sem compensar com outros tributos nem pedir ressarcimento.</li>' +
      '<li><strong>Guarde a documentação</strong> (inventário, notas fiscais e esta memória de cálculo) pelo prazo decadencial.</li></ol></div>';
    $('#e-sum').innerHTML = h;
  }

  function filtrados() {
    var b = norm(st.busca);
    return st.res.produtos.filter(function (p) {
      if (st.filtro !== 'todos' && p.situacao !== st.filtro) return false;
      if (!b) return true;
      return norm(p.cProd + ' ' + p.xProd + ' ' + p.NCM + ' ' + p.fornecedor).indexOf(b) >= 0;
    });
  }
  var TAG = { elegivel: ['g', 'Elegível'], revisar: ['', 'Revisar'], nao: ['n', 'Sem crédito'] };
  function renderTabela() {
    var lista = filtrados(), vis = lista.slice(0, st.limite);
    $('#e-cnt-prod').textContent = '— ' + lista.length + ' de ' + st.res.produtos.length + ' produto(s)';
    $('#e-tab tbody').innerHTML = vis.map(function (p) {
      var c = p._calc || E.creditoProduto(p, param()), tg = TAG[p.situacao];
      return '<tr data-id="' + esc(p.id) + '"><td><span class="tag ' + tg[0] + '">' + tg[1] + '</span></td>' +
        '<td class="prod"><strong>' + esc(p.cProd) + '</strong> ' + esc(p.xProd) + '<span class="mot">' + esc(p.motivo) + '</span></td><td>' + esc(p.NCM) + '</td><td>' + esc(p.fornecedor) + '</td><td>' + esc(p.cfops) + '</td>' +
        '<td class="v">' + qtd(p.qCompra) + ' ' + esc(p.uCom) + '</td><td class="v">' + brl(p.custoUnit) + '</td>' +
        '<td class="v"><input class="qty" data-q value="' + esc(qtd(p.qEstoque)) + '" inputmode="decimal" aria-label="Quantidade em estoque de ' + esc(p.xProd) + '"' + (p.situacao === 'nao' ? ' disabled' : '') + '></td>' +
        '<td class="v" data-ve>' + brl(c.valorEstoque) + '</td><td class="v" data-cr>' + (p.situacao === 'nao' ? '—' : brl(c.credito)) + '</td>' +
        '<td><input type="checkbox" data-inc aria-label="Somar ' + esc(p.xProd) + '"' + (p.incluir ? ' checked' : '') + (p.situacao === 'nao' ? ' disabled' : '') + '></td></tr>';
    }).join('') || '<tr><td colspan="11" style="text-align:center;color:var(--ink3);padding:18px">Nenhum produto neste filtro.</td></tr>';
    $('#e-mais-w').innerHTML = lista.length > st.limite ? '<button class="btn sec" type="button" id="e-mais">Mostrar mais ' + Math.min(300, lista.length - st.limite) + ' produtos</button>' : '';
  }
  function renderIgnorados() {
    var ign = st.erros.concat(st.res.ignoradas);
    $('#e-ign').innerHTML = ign.length ? '<details class="ign"><summary>' + ign.length + ' arquivo(s) não aproveitado(s) — ver motivos</summary><ul>' +
      ign.slice(0, 500).map(function (i) { return '<li><strong>' + esc(i.arquivo) + '</strong>: ' + esc(i.motivo) + '</li>'; }).join('') + (ign.length > 500 ? '<li>…</li>' : '') + '</ul></details>' : '';
  }
  function atualizarLinha(tr, p) {
    var c = E.creditoProduto(p, param());
    tr.querySelector('[data-ve]').textContent = brl(c.valorEstoque);
    tr.querySelector('[data-cr]').textContent = p.situacao === 'nao' ? '—' : brl(c.credito);
  }

  // ---------------------------------------------------------------- inventario (CSV)
  function importarInventario(txt) {
    txt = txt.replace(/^﻿/, '');
    var linhas = txt.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!linhas.length) return;
    var sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';
    var cab = linhas[0].split(sep).map(norm), temCab = cab.some(function (c) { return /cod|desc|produto|quant|qtd/.test(c); });
    var iCod = temCab ? cab.findIndex(function (c) { return /cod|cprod/.test(c); }) : 0;
    var iDesc = temCab ? cab.findIndex(function (c) { return /desc|produto|xprod/.test(c); }) : -1;
    var iQ = temCab ? cab.findIndex(function (c) { return /quant|qtd|qtde/.test(c); }) : 1;
    var porCod = {}, porDesc = {}, lidos = 0;
    linhas.slice(temCab ? 1 : 0).forEach(function (l) {
      var c = l.split(sep).map(function (x) { return x.replace(/^"|"$/g, '').trim(); });
      var q = num(c[iQ]); if (!q.ok || q.vazio) return;
      lidos++;
      if (iCod >= 0 && c[iCod]) porCod[norm(c[iCod])] = (porCod[norm(c[iCod])] || 0n) + E.D(q.v);
      else if (iDesc >= 0 && c[iDesc]) porDesc[norm(c[iDesc])] = (porDesc[norm(c[iDesc])] || 0n) + E.D(q.v);
    });
    // distribui a quantidade do inventario entre os produtos com o mesmo codigo/descricao, ate o limite comprado
    var grupos = {};
    st.res.produtos.forEach(function (p) {
      if (p.situacao === 'nao') return;
      var k = porCod[norm(p.cProd)] !== undefined ? 'c:' + norm(p.cProd) : (porDesc[norm(p.xProd)] !== undefined ? 'd:' + norm(p.xProd) : null);
      (grupos[k || '-'] = grupos[k || '-'] || []).push(p);
    });
    var achados = 0;
    Object.keys(grupos).forEach(function (k) {
      var ps = grupos[k];
      if (k === '-') { ps.forEach(function (p) { p.qEstoque = 0n; st.ajustes[p.id] = Object.assign(st.ajustes[p.id] || {}, { qEstoque: 0n }); }); return; }
      var resta = k[0] === 'c' ? porCod[k.slice(2)] : porDesc[k.slice(2)];
      ps.sort(function (a, b) { return a.ultimaData < b.ultimaData ? 1 : -1; }); // compras mais recentes primeiro
      ps.forEach(function (p) { var q = resta > p.qCompra ? p.qCompra : resta; resta -= q; p.qEstoque = q; st.ajustes[p.id] = Object.assign(st.ajustes[p.id] || {}, { qEstoque: q }); achados++; });
    });
    $('#e-msg').textContent = 'Inventário importado: ' + lidos + ' linha(s); ' + achados + ' produto(s) das notas encontrados. Os demais ficaram com quantidade zero.';
    renderTudo();
  }

  function exportarCsv() {
    var p = param(), t = totais(), linhas = ['situacao;codigo;descricao;ncm;fornecedor;cnpj_fornecedor;cfop_entrada;notas;qtd_comprada;unidade;custo_total_compras;custo_unitario;qtd_estoque;valor_estoque;credito;somado;motivo'];
    var br = function (v, c) { return E.toStr(v, c).replace('.', ','); };
    var q = function (v) { return String(v).indexOf(';') >= 0 || String(v).indexOf('"') >= 0 ? '"' + String(v).replace(/"/g, '""') + '"' : String(v); };
    st.res.produtos.forEach(function (x) {
      var c = E.creditoProduto(x, p);
      linhas.push([x.situacao, x.cProd, x.xProd, x.NCM, x.fornecedor, x.cnpjFornecedor, x.cfops, x.notas.join(' '), br(x.qCompra, 4), x.uCom, br(x.custo, 2), br(x.custoUnit, 4), br(E.D(x.qEstoque), 4), br(c.valorEstoque, 2), x.situacao === 'nao' ? '0,00' : br(c.credito, 2), x.incluir ? 'S' : 'N', x.motivo].map(q).join(';'));
    });
    linhas.push(''); linhas.push('credito_total;' + br(t.credito, 2));
    E.cronograma(t.credito, Number($('#e-mes').value), 2027).forEach(function (c) { linhas.push('parcela ' + c.n + ';' + MESES[c.mes - 1] + '/' + c.ano + ';' + br(c.valor, 2)); });
    var blob = new Blob(['﻿' + linhas.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'credito-estoque-2027.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------------------------------------------------------------- eventos
  function init() {
    if (!$('#v-estoque')) return;
    var drop = $('#e-drop');
    $('#e-files').addEventListener('change', function (ev) { lerArquivos(ev.target.files).then(function () { ev.target.value = ''; }); });
    $('#e-dir').addEventListener('change', function (ev) { lerArquivos(ev.target.files).then(function () { ev.target.value = ''; }); });
    drop.addEventListener('click', function () { $('#e-files').click(); });
    drop.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('#e-files').click(); } });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (ev) { ev.preventDefault(); drop.classList.add('on'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (ev) { ev.preventDefault(); drop.classList.remove('on'); }); });
    drop.addEventListener('drop', function (ev) { lerSoltos(ev.dataTransfer); });
    $('#e-limpar').addEventListener('click', function () { st.lidas = []; st.arquivos = 0; st.erros = []; st.ajustes = {}; st.res = null; $('#e-prog').hidden = true; $('#e-msg').textContent = ''; recalcular(); });
    $('#f-est').addEventListener('change', function (ev) {
      if (ev.target.id === 'e-cnpj') $('#e-cnpj').dataset.manual = $('#e-cnpj').value.trim() ? '1' : '';
      if (ev.target.id === 'e-nome') { $('#e-nome').dataset.manual = '1'; if (st.res) renderResumo(); return; }
      if (st.res) recalcular(false);
    });
    $('#f-est').addEventListener('submit', function (ev) { ev.preventDefault(); });
    $('#e-outros').addEventListener('input', function () { if (st.res) renderResumo(); });
    $('#e-aliq').addEventListener('input', function () { if (st.res) { renderResumo(); renderTabela(); } });
    $('#e-pct-ap').addEventListener('click', function () {
      if (!st.res) return;
      var r = num($('#e-pct').value, true); if (!r.ok || r.vazio) { $('#e-msg').textContent = 'Informe o percentual (ex.: 60).'; return; }
      var f = E.D(r.v);
      st.res.produtos.forEach(function (p) { var q = p.qCompra * f / (100n * 1000000n); p.qEstoque = q; st.ajustes[p.id] = Object.assign(st.ajustes[p.id] || {}, { qEstoque: q }); });
      $('#e-msg').textContent = 'Aplicado: ' + r.v.replace('.', ',') + '% da quantidade comprada em estoque.';
      renderTudo();
    });
    $('#e-inv').addEventListener('change', function (ev) { var f = ev.target.files[0]; if (!f || !st.res) return; f.text().then(function (t) { importarInventario(t); ev.target.value = ''; }); });
    $('#e-inv-mod').addEventListener('click', function () {
      var blob = new Blob(['﻿codigo;descricao;quantidade\nP100;Parafuso sextavado 6mm;750\nC10;Shampoo 300ml;120\n'], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'modelo-inventario.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500);
    });
    // tabela (delegacao)
    $('#e-res').addEventListener('input', function (ev) {
      var el = ev.target;
      if (el.id === 'e-busca') { st.busca = el.value; st.limite = 300; renderTabela(); return; }
      if (!el.matches('input[data-q]')) return;
      var tr = el.closest('tr'), p = st.res.produtos.find(function (x) { return x.id === tr.dataset.id; });
      var r = num(el.value); el.setAttribute('aria-invalid', String(!r.ok)); if (!r.ok) return;
      p.qEstoque = E.D(r.vazio ? '0' : r.v); st.ajustes[p.id] = Object.assign(st.ajustes[p.id] || {}, { qEstoque: p.qEstoque });
      atualizarLinha(tr, p); renderResumo();
    });
    $('#e-res').addEventListener('change', function (ev) {
      var el = ev.target; if (!el.matches('input[data-inc]')) return;
      var tr = el.closest('tr'), p = st.res.produtos.find(function (x) { return x.id === tr.dataset.id; });
      p.incluir = el.checked; st.ajustes[p.id] = Object.assign(st.ajustes[p.id] || {}, { incluir: el.checked });
      renderResumo();
    });
    $('#e-res').addEventListener('click', function (ev) {
      var b = ev.target.closest('.fb');
      if (b) { st.filtro = b.dataset.f; st.limite = 300; $$('#e-res .fb').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); renderTabela(); return; }
      if (ev.target.id === 'e-mais') { st.limite += 300; renderTabela(); return; }
      if (ev.target.id === 'e-csv') exportarCsv();
    });
  }
  // arrastar pastas: percorre as entradas do DataTransfer
  function lerSoltos(dt) {
    var itens = dt.items ? Array.prototype.slice.call(dt.items) : [];
    var entradas = itens.map(function (i) { return i.webkitGetAsEntry ? i.webkitGetAsEntry() : null; }).filter(Boolean);
    if (!entradas.length) { lerArquivos(dt.files); return; }
    var arquivos = [];
    function visitar(ent) {
      return new Promise(function (ok) {
        if (ent.isFile) ent.file(function (f) { arquivos.push(f); ok(); }, function () { ok(); });
        else if (ent.isDirectory) {
          var rd = ent.createReader(), todos = [];
          (function lote() { rd.readEntries(function (es) { if (!es.length) { Promise.all(todos.map(visitar)).then(ok); } else { todos = todos.concat(es); lote(); } }, function () { ok(); }); })();
        } else ok();
      });
    }
    Promise.all(entradas.map(visitar)).then(function () { lerArquivos(arquivos); });
  }

  window.ESTOQUE_UI = { _estado: st, lerArquivos: lerArquivos };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
