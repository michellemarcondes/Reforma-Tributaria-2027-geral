/*
 * Aba "Fornecedores": quem vai gerar credito de CBS/IBS em 2027.
 *  - Consulta automatica (dados abertos da Receita via BrasilAPI, reserva Minha Receita): razao social,
 *    situacao cadastral, opcao pelo Simples Nacional e pelo MEI.
 *  - A opcao pelo regime regular do IBS/CBS (regime "hibrido") so aparece em "Eventos futuros" do portal
 *    Consulta Optantes da Receita, que tem captcha: o site abre a consulta e o usuario registra o resultado,
 *    ou importa a planilha gerada pela skill consulta-regime-hibrido-cbs-ibs.
 *  - Classificacao (mesma tabela da skill):
 *      Simples + opcao regime regular ............ hibrido -> credito integral
 *      Simples sem opcao (ou opcao cancelada) ..... credito limitado ao IBS/CBS pago no DAS
 *      Exclusao do Simples agendada ............... credito integral (observacao: pode ser revertida)
 *      Nao optante do Simples ..................... regime regular pleno -> credito integral
 *      MEI ........................................ credito limitado (IBS/CBS no DAS-MEI)
 * Funcoes puras exportadas para teste no Node; a interface so inicia no navegador.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- CNPJ
  function digitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function cnpjValido(c) {
    c = digitos(c);
    if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
    var calc = function (n) {
      var pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      var s = 0; for (var i = 0; i < n; i++) s += Number(c[i]) * pesos[i];
      var r = s % 11; return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
  }
  function fmtCnpj(c) { c = digitos(c); return c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : c; }

  // ---------------------------------------------------------------- lista colada / CSV
  function numBR(s) {
    s = String(s == null ? '' : s).trim().replace(/\s|R\$/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    else if (/^-?[1-9]\d{0,2}\.\d{3}$/.test(s)) s = s.replace('.', ''); // 18.000 = dezoito mil
    var n = Number(s); return isFinite(n) ? n : null;
  }
  /** Interpreta texto (colado ou CSV): cada linha com um CNPJ e, opcionalmente, nome e valor. */
  function lerLista(texto) {
    var linhas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/), out = [], invalidos = [], vistos = {}, duplicados = 0;
    linhas.forEach(function (l, i) {
      if (!l.trim()) return;
      var partes = l.split(/\t|;|\|/).map(function (x) { return x.trim().replace(/^"|"$/g, ''); });
      if (partes.length === 1 && l.indexOf(',') >= 0) partes = l.split(',').map(function (x) { return x.trim(); });
      var iC = -1;
      partes.forEach(function (p, k) { if (iC < 0 && digitos(p).length === 14 && /^[\d.\/\-\s]+$/.test(p)) iC = k; });
      if (iC < 0) {
        var m = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/.exec(l);
        if (!m) { if (i > 0 || !/cnpj|fornec|nome/i.test(l)) invalidos.push({ linha: i + 1, texto: l.slice(0, 80), motivo: 'CNPJ não encontrado' }); return; }
        partes = [m[0], l.replace(m[0], '').replace(/[;,\t|]+/g, ' ').trim()]; iC = 0;
      }
      var cnpj = digitos(partes[iC]);
      if (!cnpjValido(cnpj)) { invalidos.push({ linha: i + 1, texto: partes[iC], motivo: 'CNPJ com dígito verificador inválido' }); return; }
      if (vistos[cnpj]) { duplicados++; return; }
      vistos[cnpj] = true;
      var nome = '', valor = null;
      partes.forEach(function (p, k) {
        if (k === iC || !p) return;
        var n = numBR(p);
        if (n !== null && /^[\d.,R$\s-]+$/.test(p)) { if (valor === null) valor = n; }
        else if (!nome) nome = p;
      });
      out.push({ cnpj: cnpj, nome: nome, valor: valor });
    });
    return { itens: out, invalidos: invalidos, duplicados: duplicados };
  }

  // ---------------------------------------------------------------- dados abertos (BrasilAPI / Minha Receita)
  /** Normaliza a resposta das APIs publicas de CNPJ. */
  function normalizarCadastro(d, fonte, hoje) {
    hoje = hoje || new Date().toISOString().slice(0, 10);
    var exc = d.data_exclusao_do_simples || null, opc = d.data_opcao_pelo_simples || null;
    var simples = d.opcao_pelo_simples === true && (!exc || exc > hoje);
    var mei = d.opcao_pelo_mei === true && (!d.data_exclusao_do_mei || d.data_exclusao_do_mei > hoje);
    return {
      razao: d.razao_social || '', fantasia: d.nome_fantasia || '', situacao: (d.descricao_situacao_cadastral || '').toUpperCase(),
      uf: d.uf || '', municipio: d.municipio || '', simples: simples, mei: mei,
      dataOpcaoSimples: simples ? opc : null, dataExclusaoSimples: !simples && d.opcao_pelo_simples === false ? exc : null,
      fonte: fonte, consultadoEm: hoje
    };
  }
  var FONTES = [
    { nome: 'BrasilAPI', url: function (c) { return 'https://brasilapi.com.br/api/cnpj/v1/' + c; } },
    { nome: 'Minha Receita', url: function (c) { return 'https://minhareceita.org/' + c; } }
  ];
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /** Consulta um CNPJ nas fontes publicas, com nova tentativa em caso de limite (429) ou falha. */
  async function consultarCnpj(cnpj, fetcher) {
    fetcher = fetcher || fetch;
    var ultimoErro = '';
    for (var f = 0; f < FONTES.length; f++) {
      for (var t = 0; t < 3; t++) {
        try {
          var r = await fetcher(FONTES[f].url(cnpj), { headers: { Accept: 'application/json' } });
          if (r.status === 404) return { erro: 'CNPJ não encontrado na base da Receita' };
          if (r.status === 429 || r.status >= 500) { ultimoErro = 'HTTP ' + r.status; await esperar(1200 * (t + 1)); continue; }
          if (!r.ok) { ultimoErro = 'HTTP ' + r.status; break; }
          return normalizarCadastro(await r.json(), FONTES[f].nome);
        } catch (e) { ultimoErro = 'falha de conexão'; await esperar(600); }
      }
    }
    return { erro: 'Não foi possível consultar (' + ultimoErro + '). Tente novamente.' };
  }

  // ---------------------------------------------------------------- classificacao
  var OPCOES = {
    '': 'Não consultado',
    optou: 'Optou pelo regime regular (híbrido)',
    naoOptou: 'Não optou (IBS/CBS no DAS)',
    cancelada: 'Opção cancelada',
    exclusao: 'Exclusão do Simples agendada'
  };
  var INT = 'Integral', LIM = 'Limitado (DAS)', PEND = 'Pendente', ATEN = 'Verificar';
  var CRED_LONGO = { 'Integral': 'Integral', 'Limitado (DAS)': 'Limitado ao IBS/CBS pago no DAS', 'Pendente': 'Pendente (confirmar opção de 2027)', 'Verificar': 'Verificar' };
  /** Classifica um fornecedor. f = {cad, opcao} */
  function classificar(f) {
    var c = f.cad;
    if (!c) return { regime: 'Não consultado', credito: PEND, obs: 'Consulte os dados do CNPJ.' };
    if (c.erro) return { regime: '—', credito: ATEN, obs: c.erro };
    var obs = [];
    if (c.situacao && c.situacao !== 'ATIVA') obs.push('Situação cadastral ' + c.situacao + ': confirme se o fornecedor ainda opera e se a nota é idônea.');
    var cred, reg;
    if (c.mei) { reg = 'MEI (Simples Nacional)'; cred = LIM; obs.push('MEI recolhe IBS/CBS em valor fixo no DAS-MEI; o crédito do adquirente fica limitado ao valor recolhido.'); }
    else if (c.simples) {
      var o = f.opcao || '';
      if (o === 'optou') { reg = 'Simples — regime híbrido (IBS/CBS fora do DAS)'; cred = INT; }
      else if (o === 'naoOptou') { reg = 'Simples — IBS/CBS dentro do DAS'; cred = LIM; }
      else if (o === 'cancelada') { reg = 'Simples — IBS/CBS dentro do DAS'; cred = LIM; obs.push('Opção pelo regime regular cancelada: não conta como híbrido.'); }
      else if (o === 'exclusao') { reg = 'Sai do Simples — regime regular pleno'; cred = INT; obs.push('Exclusão agendada pode ser revertida se a empresa regularizar; reconsultar. Se seguir no Simples sem opção, o crédito passa a ser limitado.'); }
      else { reg = 'Simples Nacional — opção 2027 a confirmar'; cred = PEND; obs.push('Consulte “Eventos futuros” no Consulta Optantes da Receita para saber se optou pelo regime regular do IBS/CBS.'); }
    } else { reg = 'Regime regular pleno (fora do Simples)'; cred = INT; }
    if (f.nome && c.razao) {
      var a = f.nome.toUpperCase().replace(/[^A-Z0-9]/g, ''), b = c.razao.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (a.slice(0, 8) && b.indexOf(a.slice(0, 8)) < 0 && a.indexOf(b.slice(0, 8)) < 0) obs.push('Razão social na Receita difere do nome da lista.');
    }
    return { regime: reg, credito: cred, obs: obs.join(' ') };
  }

  /** Le o resultado da planilha da skill (linhas como objetos {coluna: valor}). Retorna {cnpj: {opcao, cad?}} */
  function lerPlanilhaSkill(linhas) {
    var out = {};
    linhas.forEach(function (l) {
      var k = {}; Object.keys(l).forEach(function (c) { k[c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')] = String(l[c] == null ? '' : l[c]); });
      var cnpj = digitos(k['cnpj']); if (cnpj.length !== 14) return;
      var hib = k['vai ser regime hibrido?'] || '', sn = k['situacao atual no simples nacional'] || '', fut = k['eventos futuros – simples nacional'] || k['eventos futuros - simples nacional'] || '', obs = k['observacao'] || '';
      var simples = /^optante pelo simples/i.test(sn);
      var opcao = '';
      if (/exclus/i.test(fut)) opcao = 'exclusao';
      else if (simples && /^sim/i.test(hib)) opcao = 'optou';
      else if (simples && /cancelada/i.test(obs)) opcao = 'cancelada';
      else if (simples) opcao = 'naoOptou';
      out[cnpj] = { opcao: opcao, simples: simples || /exclus/i.test(fut), razao: k['razao social na receita'] || '' };
    });
    return out;
  }

  // ---------------------------------------------------------------- leitura de .xlsx (sem biblioteca externa)
  /** Le a primeira planilha (ou a chamada "Fornecedores") de um .xlsx. Retorna linhas como objetos. */
  async function lerXlsx(bytes, listarZip) {
    var ents = listarZip(bytes), mapa = {};
    ents.forEach(function (e) { mapa[e.nome] = e; });
    var txt = async function (n) { return mapa[n] ? new TextDecoder('utf-8').decode(await mapa[n].ler()) : ''; };
    var dec = function (s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, '&'); };
    var ss = [], sx = await txt('xl/sharedStrings.xml');
    (sx.match(/<si>[\s\S]*?<\/si>/g) || []).forEach(function (si) { ss.push(dec((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join(''))); });
    var wb = await txt('xl/workbook.xml'), rels = await txt('xl/_rels/workbook.xml.rels');
    var sheets = []; var re = /<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g, m;
    while ((m = re.exec(wb))) sheets.push({ nome: dec(m[1]), rid: m[2] });
    var alvo = sheets.filter(function (s) { return /fornecedor/i.test(s.nome); })[0] || sheets[0];
    if (!alvo) throw new Error('planilha sem abas');
    var rm = new RegExp('<Relationship\\b[^>]*Id="' + alvo.rid + '"[^>]*Target="([^"]*)"').exec(rels) || new RegExp('<Relationship\\b[^>]*Target="([^"]*)"[^>]*Id="' + alvo.rid + '"').exec(rels);
    var caminho = rm ? rm[1].replace(/^\/?(xl\/)?/, 'xl/') : 'xl/worksheets/sheet1.xml';
    var sh = await txt(caminho), linhas = [];
    (sh.match(/<row\b[\s\S]*?<\/row>/g) || []).forEach(function (row) {
      var cel = {};
      (row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach(function (c) {
        var ref = (/\br="([A-Z]+)\d+"/.exec(c) || [])[1], t = (/\bt="([^"]+)"/.exec(c) || [])[1];
        var v = (/<v>([\s\S]*?)<\/v>/.exec(c) || [])[1], is = (/<is>([\s\S]*?)<\/is>/.exec(c) || [])[1];
        var valor = t === 's' ? ss[Number(v)] : t === 'inlineStr' ? dec((is || '').replace(/<[^>]+>/g, '')) : dec(v || '');
        if (ref) cel[ref] = valor;
      });
      linhas.push(cel);
    });
    if (!linhas.length) return [];
    var cab = linhas[0];
    return linhas.slice(1).map(function (l) { var o = {}; Object.keys(cab).forEach(function (col) { o[cab[col]] = l[col] == null ? '' : l[col]; }); return o; });
  }

  var API = { digitos: digitos, cnpjValido: cnpjValido, fmtCnpj: fmtCnpj, lerLista: lerLista, normalizarCadastro: normalizarCadastro,
    consultarCnpj: consultarCnpj, classificar: classificar, lerPlanilhaSkill: lerPlanilhaSkill, lerXlsx: lerXlsx, OPCOES: OPCOES,
    CRED: { INT: INT, LIM: LIM, PEND: PEND, ATEN: ATEN } };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  root.FORNEC = API;

  // ================================================================== interface (navegador)
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var nf = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dataBR(d) { return d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''; }
  var CONSOPT = 'https://consopt.www8.receita.fazenda.gov.br/consultaoptantes';
  var st = { lista: [], filtro: 'todos', ocupado: false, chave: 'rtc-fornecedores' };

  function salvar() { try { localStorage.setItem(st.chave, JSON.stringify(st.lista)); } catch (e) { } }
  function carregar() { try { st.lista = JSON.parse(localStorage.getItem(st.chave) || '[]') || []; } catch (e) { st.lista = []; } }

  function adicionar(itens, origem) {
    var idx = {}; st.lista.forEach(function (f, i) { idx[f.cnpj] = i; });
    var novos = 0;
    itens.forEach(function (it) {
      if (idx[it.cnpj] !== undefined) { var f = st.lista[idx[it.cnpj]]; if (!f.nome && it.nome) f.nome = it.nome; if (f.valor == null && it.valor != null) f.valor = it.valor; return; }
      st.lista.push({ cnpj: it.cnpj, nome: it.nome || '', valor: it.valor, cad: null, opcao: it.opcao || '' }); idx[it.cnpj] = st.lista.length - 1; novos++;
    });
    salvar(); render();
    return novos;
  }

  async function consultarTodos(somentePendentes) {
    if (st.ocupado) return;
    var alvo = st.lista.filter(function (f) { return !somentePendentes || !f.cad || f.cad.erro; });
    if (!alvo.length) { $('#f-msg').textContent = 'Nada a consultar.'; return; }
    st.ocupado = true; $('#f-consultar').disabled = true;
    var feitos = 0, i = 0;
    var prog = function () { $('#f-prog').hidden = false; $('#f-bar').style.width = Math.round(feitos * 100 / alvo.length) + '%'; $('#f-prog-txt').textContent = 'Consultando ' + feitos + ' de ' + alvo.length + ' CNPJs na base pública da Receita…'; };
    prog();
    async function worker() {
      while (i < alvo.length) {
        var f = alvo[i++];
        f.cad = await consultarCnpj(f.cnpj);
        feitos++; prog();
        if (feitos % 5 === 0) { salvar(); renderTabela(); renderResumo(); }
        await esperar(350);
      }
    }
    try { await Promise.all([worker(), worker(), worker()]); }
    finally { st.ocupado = false; $('#f-consultar').disabled = false; }
    $('#f-prog-txt').textContent = alvo.length + ' CNPJ(s) consultados em ' + new Date().toLocaleDateString('pt-BR') + '.';
    salvar(); render();
  }

  function contagem() {
    var t = { total: st.lista.length, valorTotal: 0 }, tipos = {};
    tipos[INT] = { n: 0, v: 0 }; tipos[LIM] = { n: 0, v: 0 }; tipos[PEND] = { n: 0, v: 0 }; tipos[ATEN] = { n: 0, v: 0 };
    st.lista.forEach(function (f) { var c = classificar(f); f._c = c; tipos[c.credito].n++; tipos[c.credito].v += f.valor || 0; t.valorTotal += f.valor || 0; });
    t.tipos = tipos; return t;
  }
  function pctTxt(v, tot) { return tot > 0 ? ' · ' + (v * 100 / tot).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '% das compras' : ''; }
  function renderResumo() {
    var t = contagem(), el = $('#f-sum');
    if (!t.total) { el.innerHTML = ''; return; }
    var T = t.tipos, v = function (x) { return t.valorTotal > 0 ? nf.format(x.v) + pctTxt(x.v, t.valorTotal) : ''; };
    el.innerHTML = '<div class="counts">' +
      '<div class="ct a"><div class="n">' + T[INT].n + '</div><div class="l"><strong>Crédito integral</strong> em 2027 (regime regular ou híbrido)<br>' + v(T[INT]) + '</div></div>' +
      '<div class="ct b"><div class="n">' + T[LIM].n + '</div><div class="l"><strong>Crédito limitado</strong> ao IBS/CBS pago no DAS (Simples/MEI)<br>' + v(T[LIM]) + '</div></div>' +
      '<div class="ct"><div class="n">' + T[PEND].n + '</div><div class="l"><strong>Pendentes</strong>: optantes do Simples — confirmar a opção de 2027 na Receita<br>' + v(T[PEND]) + '</div></div>' +
      '<div class="ct r"><div class="n">' + T[ATEN].n + '</div><div class="l"><strong>Verificar</strong>: CNPJ não encontrado ou falha na consulta<br>' + v(T[ATEN]) + '</div></div></div>';
  }
  var TAGC = {}; TAGC[INT] = 'g'; TAGC[LIM] = ''; TAGC[PEND] = 'n'; TAGC[ATEN] = 'r';
  function renderTabela() {
    contagem();
    var lista = st.lista.filter(function (f) { var c = f._c.credito; return st.filtro === 'todos' || (st.filtro === 'int' && c === INT) || (st.filtro === 'lim' && c === LIM) || (st.filtro === 'pend' && c === PEND) || (st.filtro === 'aten' && c === ATEN); });
    $('#f-cnt').textContent = st.lista.length ? '— ' + lista.length + ' de ' + st.lista.length + ' fornecedor(es)' : '';
    $('#f-tab tbody').innerHTML = lista.map(function (f) {
      var c = f.cad, cl = f._c;
      var sn = !c ? '—' : c.erro ? '—' : c.mei ? 'MEI' : c.simples ? 'Optante' + (c.dataOpcaoSimples ? ' desde ' + dataBR(c.dataOpcaoSimples) : '') : 'Não optante' + (c.dataExclusaoSimples ? ' (excluído em ' + dataBR(c.dataExclusaoSimples) + ')' : '');
      var opc = c && !c.erro && c.simples && !c.mei
        ? '<select data-op aria-label="Opção pelo regime regular em 2027 de ' + esc(f.nome || c.razao) + '">' + Object.keys(OPCOES).map(function (k) { return '<option value="' + k + '"' + ((f.opcao || '') === k ? ' selected' : '') + '>' + OPCOES[k] + '</option>'; }).join('') + '</select>' +
          '<button class="btn small sec" type="button" data-rf title="Copia o CNPJ e abre o Consulta Optantes da Receita (clique em “Mais informações” e veja “Eventos futuros”)">Copiar CNPJ e abrir Receita ↗</button>'
        : '<span class="nome">—</span>';
      var sit = c && !c.erro && c.situacao && c.situacao !== 'ATIVA' ? '<span class="mot alerta">Situação: ' + esc(c.situacao) + '</span>' : '';
      return '<tr data-c="' + f.cnpj + '"><td class="forn"><strong>' + esc(f.nome || (c && c.razao) || '—') + '</strong>' + (c && c.razao && f.nome && c.razao.toUpperCase() !== f.nome.toUpperCase() ? '<span class="mot">Receita: ' + esc(c.razao) + '</span>' : '') + '</td>' +
        '<td class="nowrap">' + fmtCnpj(f.cnpj) + '</td>' +
        '<td><span class="tag ' + TAGC[cl.credito] + '" title="' + esc(CRED_LONGO[cl.credito]) + '">' + esc(cl.credito) + '</span></td>' +
        '<td>' + esc(sn) + sit + '</td><td class="opc">' + opc + '</td>' +
        '<td class="reg">' + esc(cl.regime) + (cl.obs ? '<span class="mot">' + esc(cl.obs) + '</span>' : '') + '</td>' +
        '<td class="v">' + (f.valor != null ? nf.format(f.valor) : '—') + '</td>' +
        '<td class="no-print"><button class="btn link" type="button" data-del aria-label="Remover ' + esc(f.nome || f.cnpj) + '">✕</button></td></tr>';
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--ink3);padding:20px">Nenhum fornecedor. Cole a lista acima, importe um arquivo ou traga os fornecedores das notas da aba “Crédito de estoque”.</td></tr>';
  }
  function render() { renderResumo(); renderTabela(); $('#f-res').hidden = !st.lista.length; }

  function exportar() {
    var q = function (v) { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var l = ['cnpj;fornecedor;razao_social_receita;situacao_cadastral;simples_nacional;mei;opcao_regime_regular_2027;regime_2027;credito_cbs_ibs_2027;valor;observacao;consultado_em;fonte'];
    contagem();
    st.lista.forEach(function (f) { var c = f.cad || {}; l.push([fmtCnpj(f.cnpj), f.nome, c.razao, c.situacao, c.erro ? '' : (c.simples ? 'Optante' : 'Não optante'), c.mei ? 'Sim' : 'Não', c.simples ? OPCOES[f.opcao || ''] : '', f._c.regime, CRED_LONGO[f._c.credito], f.valor != null ? String(f.valor.toFixed(2)).replace('.', ',') : '', f._c.obs, dataBR(c.consultadoEm), c.fonte].map(q).join(';')); });
    var blob = new Blob(['﻿' + l.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fornecedores-credito-2027.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  async function importarArquivo(file) {
    var msg = $('#f-msg');
    if (/\.xlsx$/i.test(file.name)) {
      if (!root.ESTOQUE) { msg.textContent = 'Leitor de .xlsx indisponível.'; return; }
      var linhas = await lerXlsx(new Uint8Array(await file.arrayBuffer()), root.ESTOQUE.listarZip);
      var temSkill = linhas.length && Object.keys(linhas[0]).some(function (k) { return /regime h[ií]brido/i.test(k); });
      if (temSkill) {
        var res = lerPlanilhaSkill(linhas), itens = [];
        linhas.forEach(function (l) {
          var cn = digitos(l['CNPJ']); if (!res[cn]) return;
          var val = l['Valor (R$)'] !== undefined && l['Valor (R$)'] !== '' ? Number(l['Valor (R$)']) : null;
          itens.push({ cnpj: cn, nome: l['Fornecedor'] || '', valor: isFinite(val) ? val : null, opcao: res[cn].opcao });
        });
        var n = adicionar(itens);
        var hoje = new Date().toISOString().slice(0, 10);
        st.lista.forEach(function (f) {
          var r = res[f.cnpj]; if (!r) return;
          f.opcao = r.opcao;
          if (!f.cad || f.cad.erro) f.cad = { razao: r.razao, situacao: '', simples: r.simples, mei: false, fonte: 'Planilha da consulta de regime', consultadoEm: hoje };
          else f.cad.simples = r.simples;
        });
        salvar(); render();
        msg.textContent = 'Planilha da consulta de regime importada: ' + itens.length + ' CNPJ(s), ' + n + ' novo(s), já classificados. Se quiser, clique em “Consultar CNPJs” para trazer também a situação cadastral.';
        return;
      }
      var txt = linhas.map(function (l) { return Object.keys(l).map(function (k) { return l[k]; }).join(';'); }).join('\n');
      var r = lerLista(txt); adicionar(r.itens); msg.textContent = r.itens.length + ' CNPJ(s) lidos da planilha.' + avisoInvalidos(r);
      return;
    }
    var r2 = lerLista(await file.text()); adicionar(r2.itens); msg.textContent = r2.itens.length + ' CNPJ(s) lidos do arquivo.' + avisoInvalidos(r2);
  }
  function avisoInvalidos(r) {
    return (r.duplicados ? ' ' + r.duplicados + ' duplicado(s) ignorado(s).' : '') + (r.invalidos.length ? ' ' + r.invalidos.length + ' linha(s) com CNPJ inválido: ' + r.invalidos.slice(0, 5).map(function (x) { return x.texto; }).join(', ') + (r.invalidos.length > 5 ? '…' : '') + '.' : '');
  }

  function init() {
    var sec = $('#v-fornec'); if (!sec) return;
    st.chave = sec.getAttribute('data-store') || st.chave;
    carregar(); render();
    $('#f-add').addEventListener('click', function () {
      var r = lerLista($('#f-txt').value);
      var n = adicionar(r.itens);
      $('#f-msg').textContent = r.itens.length ? n + ' fornecedor(es) adicionado(s).' + avisoInvalidos(r) + (n ? ' Clique em “Consultar CNPJs”.' : '') : 'Nenhum CNPJ válido encontrado.' + avisoInvalidos(r);
      if (r.itens.length) $('#f-txt').value = '';
    });
    $('#f-file').addEventListener('change', function (ev) { var f = ev.target.files[0]; if (f) importarArquivo(f).catch(function (e) { $('#f-msg').textContent = 'Não foi possível ler o arquivo: ' + e.message; }).then(function () { ev.target.value = ''; }); });
    $('#f-notas').addEventListener('click', function () {
      var est = root.ESTOQUE_UI && root.ESTOQUE_UI._estado;
      if (!est || !est.lidas.length) { $('#f-msg').textContent = 'Envie primeiro os XMLs na aba “Crédito de estoque”.'; return; }
      var emp = (est.res && est.res.cnpjEmpresa) || '', por = {};
      est.lidas.forEach(function (n) {
        if (n.tipo !== 'nfe' || n.emit.cnpj === emp || n.dest.cnpj !== emp || n.tpNF !== '1' || digitos(n.emit.cnpj).length !== 14) return;
        var v = n.itens.reduce(function (a, it) { return a + (Number(it.vProd) || 0) - (Number(it.vDesc) || 0); }, 0);
        var p = por[n.emit.cnpj] = por[n.emit.cnpj] || { cnpj: n.emit.cnpj, nome: n.emit.nome, valor: 0, chaves: {} };
        if (!p.chaves[n.chave]) { p.chaves[n.chave] = 1; p.valor += v; }
      });
      var itens = Object.keys(por).map(function (k) { return { cnpj: k, nome: por[k].nome, valor: Math.round(por[k].valor * 100) / 100 }; });
      var n = adicionar(itens, 'notas');
      $('#f-msg').textContent = itens.length + ' fornecedor(es) encontrados nas notas (' + n + ' novo(s)). Clique em “Consultar CNPJs”.';
    });
    $('#f-consultar').addEventListener('click', function () { consultarTodos(false); });
    $('#f-repetir').addEventListener('click', function () { consultarTodos(true); });
    $('#f-limpar').addEventListener('click', function () { if (st.lista.length && confirm('Remover todos os fornecedores da lista?')) { st.lista = []; salvar(); render(); $('#f-prog').hidden = true; } });
    $('#f-csv').addEventListener('click', exportar);
    $('#f-print').addEventListener('click', function () { window.print(); });
    $('#f-res').addEventListener('change', function (ev) {
      if (!ev.target.matches('select[data-op]')) return;
      var f = st.lista.find(function (x) { return x.cnpj === ev.target.closest('tr').dataset.c; });
      f.opcao = ev.target.value; salvar(); renderResumo(); renderTabela();
    });
    $('#f-res').addEventListener('click', function (ev) {
      var b = ev.target.closest('.fb');
      if (b) { st.filtro = b.dataset.f; $$('#f-res .fb').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); renderTabela(); return; }
      var tr = ev.target.closest('tr'); if (!tr || !tr.dataset.c) return;
      if (ev.target.closest('[data-del]')) { st.lista = st.lista.filter(function (x) { return x.cnpj !== tr.dataset.c; }); salvar(); render(); return; }
      if (ev.target.closest('[data-rf]')) {
        try { navigator.clipboard.writeText(tr.dataset.c); } catch (e) { }
        window.open(CONSOPT, '_blank', 'noopener');
        $('#f-msg').textContent = 'CNPJ ' + fmtCnpj(tr.dataset.c) + ' copiado. Na Receita: cole o CNPJ, clique em Consultar, depois em “Mais informações” e veja “Eventos Futuros (Regime Regular IBS/CBS)”. Registre o resultado na linha.';
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
