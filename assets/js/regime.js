/*
 * Aba "Melhor regime 2027": Lucro Presumido x Lucro Real x Simples Nacional (padrao e hibrido).
 *
 * Fontes de dados (12 meses, lidos no navegador):
 *  - EFD ICMS/IPI: 0000, 0150, 0200 (NCM), C100/C190 (vendas, devolucoes, compras por CFOP), E110 (ICMS a recolher);
 *  - EFD Contribuicoes: 0000, 0110 (regime de PIS/Cofins), 0150, 0200, C100/C170 (vendas por item/NCM),
 *    A100/A170 (servicos, item da LC 116), F500/F550 (receita consolidada), M200/M600 (PIS/Cofins 2026);
 *  - ECD (I050 + I355: resultado antes do encerramento) ou balancete CSV/XLSX: DRE (custos, folha, despesas).
 *
 * Calculo 2027 (premissas editaveis):
 *  - CBS/IBS: debito por faixa de beneficio (enquadramento automatico por NCM / LC 116 -> NBS) menos credito
 *    sobre compras; igual no Presumido e no Real (ambos no regime regular). Base 2027 sem ICMS/ISS.
 *  - Lucro Presumido: presuncao trimestral (8/12% mercadorias, 32/32% servicos ou o informado), com o acrescimo
 *    de 10% da LC 224/2025 sobre a receita que excede R$ 1,25 mi no trimestre; IRPJ 15% + adicional 10% sobre
 *    o que exceder R$ 60 mil no trimestre; CSLL 9%. Outras receitas entram integralmente.
 *  - Lucro Real (anual): lucro contabil + adicoes - exclusoes, compensacao de prejuizo limitada a 30%; IRPJ 15% +
 *    adicional 10% sobre o que exceder R$ 240 mil; CSLL 9%.
 *  - INSS patronal sobre folha e pro-labore; ICMS e ISS informados/apurados.
 *  - Simples Nacional: DAS pelas tabelas da LC 123 (motor RTC.simplesAliquotas), sublimite de R$ 3,6 mi
 *    (ICMS/ISS fora do DAS), CPP fora do DAS no Anexo IV; hibrido = DAS sem CBS/IBS + CBS/IBS do regime regular.
 */
(function (root) {
  'use strict';
  var R = root.RTC || (typeof require !== 'undefined' ? require('./engine.js') : null);

  // ---------------------------------------------------------------- utilitarios
  function n(v) { if (v === undefined || v === null || v === '') return 0; var x = Number(String(v).replace(',', '.')); return isFinite(x) ? x : 0; }
  function r2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
  function campos(l) { return l.split('|'); }           // linha SPED: |REG|C1|C2|...|  -> ['', REG, C1, ...]
  function mes(dt) { return dt && dt.length === 8 ? dt.slice(4, 8) + '-' + dt.slice(2, 4) : ''; } // ddmmaaaa -> aaaa-mm
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  // ---------------------------------------------------------------- identificacao do arquivo
  function detectar(texto) {
    var ini = texto.slice(0, 400);
    if (!/^\s*\|0000\|/.test(ini)) return 'desconhecido';
    if (/^\s*\|0000\|LECD\|/.test(ini)) return 'ecd';
    if (/\n\|0110\|/.test(texto.slice(0, 20000)) || /\n\|M200\|/.test(texto)) return 'contrib';
    return 'icms';
  }

  // CFOPs (ultimos 3 digitos)
  function grupoSaida(cfop) {
    var c = String(cfop), r = Number(c.slice(1));
    if (c[0] === '7' || r === 501 || r === 502) return 'exportacao';
    if ((r >= 101 && r <= 125) || (r >= 401 && r <= 405) || (r >= 651 && r <= 667 && r !== 657 && r !== 658 && r !== 659)) return 'venda';
    if (r === 933 || r === 932) return 'servico';
    return 'outras';
  }
  function grupoEntrada(cfop) {
    var c = String(cfop), r = Number(c.slice(1));
    if ((r >= 201 && r <= 210) || (r >= 410 && r <= 411) || r === 553 || r === 660 || r === 661 || r === 662) return 'devolucao';
    if ((r >= 151 && r <= 155) || r === 408 || r === 409 || r === 552 || r === 557 || r === 658 || r === 659) return 'transferencia';
    if (r >= 900) return 'remessa';
    return 'compra';
  }

  // ---------------------------------------------------------------- EFD ICMS/IPI
  function lerEfdIcms(texto) {
    var o = { tipo: 'icms', cnpj: '', nome: '', mes: '', uf: '', vendas: 0, exportacao: 0, servicosIcms: 0, devolucoes: 0, compras: 0, icmsCompras: 0,
      icmsRecolher: 0, ncmVendas: {}, devolNcm: {}, b2b: 0, b2c: 0, itens: {}, part: {} };
    var c100 = null, docSaida = false, valido = true;
    texto.split(/\r?\n/).forEach(function (l) {
      if (l.charAt(0) !== '|') return;
      var f = campos(l), reg = f[1];
      switch (reg) {
        case '0000': o.mes = mes(f[4]); o.nome = f[6]; o.cnpj = f[7]; o.uf = f[9]; break;
        case '0150': o.part[f[2]] = { cnpj: f[5], cpf: f[6] }; break;
        case '0200': o.itens[f[2]] = { desc: f[3], tipo: f[7], ncm: f[8], lst: f[11] }; break;
        case 'C100':
          valido = ['02', '03', '04', '05'].indexOf(f[6]) < 0;
          docSaida = f[2] === '1';
          c100 = { part: f[4], mod: f[5] };
          break;
        case 'C170':
          if (valido && docSaida) {
            var it = o.itens[f[3]] || {}, v = n(f[7]) - n(f[8]);
            if (grupoSaida(f[11]) === 'venda' && it.ncm) o.ncmVendas[it.ncm] = (o.ncmVendas[it.ncm] || 0) + v;
          } else if (valido && grupoEntrada(f[11]) === 'devolucao') {
            var itd = o.itens[f[3]] || {};
            if (itd.ncm) o.devolNcm[itd.ncm] = (o.devolNcm[itd.ncm] || 0) + n(f[7]) - n(f[8]);
          }
          break;
        case 'C190':
          if (!valido) break;
          var vop = n(f[5]) - n(f[11]) - n(f[9]);    // VL_OPR - VL_IPI - VL_ICMS_ST
          if (docSaida) {
            var g = grupoSaida(f[3]);
            if (g === 'venda') {
              o.vendas += vop;
              var p = o.part[c100.part] || {};
              if (p.cnpj) o.b2b += vop; else o.b2c += vop;
            } else if (g === 'exportacao') o.exportacao += vop;
            else if (g === 'servico') o.servicosIcms += vop;
          } else {
            var ge = grupoEntrada(f[3]);
            if (ge === 'devolucao') o.devolucoes += vop;
            else if (ge === 'compra') { o.compras += vop; o.icmsCompras += n(f[7]); }
          }
          break;
        case 'E110': o.icmsRecolher += n(f[13]) + n(f[15]); break;   // VL_ICMS_RECOLHER + DEB_ESP
      }
    });
    return o;
  }

  // ---------------------------------------------------------------- EFD Contribuicoes
  function lerEfdContrib(texto) {
    var o = { tipo: 'contrib', cnpj: '', nome: '', mes: '', regimePisCofins: '', vendasItens: 0, ncmVendas: {}, servicos: 0, servicosLst: {}, iss: 0,
      servicosTomados: 0, comprasItens: 0, receitaF5: 0, pis: 0, cofins: 0, devolNcm: {}, devolItens: 0, b2bMerc: 0, b2cMerc: 0, b2bServ: 0, b2cServ: 0, itens: {}, part: {} };
    var valido = true, saida = false, partDoc = '', tipoDoc = '';
    texto.split(/\r?\n/).forEach(function (l) {
      if (l.charAt(0) !== '|') return;
      var f = campos(l), reg = f[1];
      switch (reg) {
        case '0000': o.mes = mes(f[7]); o.nome = f[8]; o.cnpj = f[9]; break;
        case '0110': o.regimePisCofins = f[2] === '2' ? 'cumulativo' : f[2] === '1' ? 'nao-cumulativo' : 'misto'; break;
        case '0150': o.part[f[2]] = { cnpj: f[5], cpf: f[6] }; break;
        case '0200': o.itens[f[2]] = { desc: f[3], tipo: f[7], ncm: f[8], lst: f[11] }; break;
        case 'C100': valido = ['02', '03', '04', '05'].indexOf(f[6]) < 0; saida = f[2] === '1'; partDoc = f[4]; tipoDoc = 'C'; break;
        case 'C170':
          if (!valido) break;
          var it = o.itens[f[3]] || {}, v = n(f[7]) - n(f[8]);
          if (saida) {
            var g = grupoSaida(f[11]);
            if (g === 'venda') {
              o.vendasItens += v;
              if (it.ncm) o.ncmVendas[it.ncm] = (o.ncmVendas[it.ncm] || 0) + v;
              var p = o.part[partDoc] || {}; if (p.cnpj) o.b2bMerc += v; else o.b2cMerc += v;
            }
          } else if (grupoEntrada(f[11]) === 'compra') o.comprasItens += v;
          else if (grupoEntrada(f[11]) === 'devolucao') { o.devolItens += v; if (it.ncm) o.devolNcm[it.ncm] = (o.devolNcm[it.ncm] || 0) + v; }
          break;
        case 'A100': valido = f[5] !== '02'; saida = f[2] === '1'; partDoc = f[4]; tipoDoc = 'A';
          if (valido && saida) o.iss += n(f[21]);   // VL_ISS
          break;
        case 'A170':
          if (!valido) break;
          var vs = n(f[5]) - n(f[6]), its = o.itens[f[3]] || {};
          if (saida) {
            o.servicos += vs;
            var lst = String(its.lst || '').replace(/\D/g, '');
            var k = lst ? String(Number(lst.slice(0, lst.length - 2))) + '.' + lst.slice(-2) : '';
            o.servicosLst[k] = (o.servicosLst[k] || 0) + vs;
            var ps = o.part[partDoc] || {}; if (ps.cnpj) o.b2bServ += vs; else o.b2cServ += vs;
          } else o.servicosTomados += vs;
          break;
        case 'F500': case 'F550': o.receitaF5 += n(f[2]); break;
        case 'M200': o.pis += n(f[13]); break;
        case 'M600': o.cofins += n(f[13]); break;
      }
    });
    return o;
  }

  // ---------------------------------------------------------------- DRE: ECD (I050/I355) e balancete
  var CLASSES = [
    ['ignorar', /imposto de renda|\birpj\b|contribui[cç][aã]o social s|\bcsll\b|provis[aã]o para (ir|csll)/],
    ['ignorar', /\bicms\b|\bpis\b|cofins|\biss\b|issqn|simples nacional|\bdas\b(?!\s+[a-z])|\bcbs\b|\bibs\b|impostos? (s|sobre)|tributos sobre|dedu[cç]/],
    ['devol', /devolu|cancelad|abatimento|descontos? incondicion|descontos? concedid/],
    ['proLabore', /pr[oó][- ]?labore/],
    ['cpp', /\binss\b|previd|encargos sociais|\brat\b|sat\b|terceiros \(|contribui[cç][aã]o patronal/],
    ['deprec', /deprecia|amortiza|exaust/],
    ['folha', /sal[aá]rio|ordenado|f[eé]rias|13[ºo]? sal|d[eé]cimo|rescis|horas? extra|gratifica|aviso pr[eé]vio|adicional noturno|insalub|periculos|vale[- ](transp|refei|alim)|assist[eê]ncia m[eé]dica|plano de sa[uú]de|benef[ií]cios a empreg/],
    ['cmv', /custo|\bcmv\b|\bcpv\b|\bcsp\b|mercadorias? vendid|produtos? vendid|servi[cç]os? vendid|mat[eé]ria[- ]prima|insumos?/],
    ['outrasRec', /receitas? financ|juros ativos|rendimento|aplica[cç][oõ]es financ|descontos? obtid|varia[cç][aã]o cambial ativa|alugu[eé]is? recebid|receita de alugu|outras receitas|ganho/],
    ['receitaServ', /servi[cç]os? prestad|receita de servi|presta[cç][aã]o de servi|honor[aá]rios receb|receita com servi/],
    ['receitaMerc', /venda|receita|faturamento/],
    ['despFin', /juros pass|despesas? financ|tarifa|\biof\b|multa|varia[cç][aã]o cambial passiva/],
    ['despCred', /alugu|energia|telefon|internet|frete|carreto|transporte|servi[cç]os? de terceiros|servi[cç]os? (prestados )?(por )?pessoa jur|manuten|conserva|combust|material|embalag|seguros?|publicidade|propaganda|marketing|software|licen[cç]a|sistema|consultoria|assessoria|honor[aá]rios|limpeza|vigil|seguran[cç]a|[aá]gua|condom[ií]nio|leasing|arrendamento/]
  ];
  function classificarConta(desc, natureza) {
    var d = norm(desc);
    for (var i = 0; i < CLASSES.length; i++) {
      if (CLASSES[i][1].test(d)) {
        var k = CLASSES[i][0];
        if ((k === 'receitaMerc' || k === 'receitaServ' || k === 'outrasRec') && natureza === 'D') return /juros|financ/.test(d) ? 'despFin' : 'despSemCred';
        return k;
      }
    }
    return natureza === 'C' ? 'outrasRec' : 'despSemCred';
  }
  var DRE_CAMPOS = ['receitaMerc', 'receitaServ', 'outrasRec', 'devol', 'cmv', 'folha', 'proLabore', 'despCred', 'despSemCred', 'despFin', 'deprec'];
  function dreVazia() { var d = {}; DRE_CAMPOS.forEach(function (k) { d[k] = 0; }); d.contas = []; return d; }
  function somarConta(dre, cod, desc, valor, dc) {
    var k = classificarConta(desc, dc);
    dre.contas.push({ cod: cod, desc: desc, valor: r2(valor), dc: dc, classe: k });
    if (k === 'ignorar' || k === 'cpp') return;
    // receitas (C) somam; despesas (D) somam; sinal contrario reduz
    var receita = ['receitaMerc', 'receitaServ', 'outrasRec'].indexOf(k) >= 0;
    var v = Math.abs(valor) * ((receita ? dc === 'C' : dc === 'D') ? 1 : -1);
    dre[k] += v;
  }

  function lerEcd(texto) {
    var o = { tipo: 'ecd', cnpj: '', nome: '', mes: '', ini: '', fim: '', dre: dreVazia(), temI355: false };
    var contas = {};
    texto.split(/\r?\n/).forEach(function (l) {
      if (l.charAt(0) !== '|') return;
      var f = campos(l);
      if (f[1] === '0000') { o.ini = mes(f[3]); o.fim = mes(f[4]); o.mes = o.fim; o.nome = f[5]; o.cnpj = f[6]; }
      else if (f[1] === 'I050') contas[f[6]] = { nat: f[3], ind: f[4], desc: f[8] };
      else if (f[1] === 'I355') {
        o.temI355 = true;
        var c = contas[f[2]] || { nat: '04', desc: f[2] };
        if (c.nat === '04' || !c.nat) somarConta(o.dre, f[2], c.desc, n(f[4]), f[5]);
      }
    });
    return o;
  }

  /** Balancete em linhas (CSV ou planilha): detecta colunas de codigo, descricao, saldo/debito/credito. */
  function lerBalancete(linhas) {
    var o = { tipo: 'balancete', mes: '', dre: dreVazia(), aviso: '' };
    var hi = -1, cab = [];
    for (var i = 0; i < Math.min(linhas.length, 30); i++) {
      var c = linhas[i].map(norm);
      if (c.some(function (x) { return /descri|conta|nome/.test(x); }) && c.some(function (x) { return /saldo|debito|credito|valor/.test(x); })) { hi = i; cab = c; break; }
    }
    if (hi < 0) { o.aviso = 'cabeçalho não reconhecido (precisa de colunas de conta/descrição e saldo ou débito/crédito)'; return o; }
    var iCod = cab.findIndex(function (x) { return /^cod|classifica|reduzid|^conta$/.test(x); });
    var iDesc = cab.findIndex(function (x) { return /descri|nome/.test(x); }); if (iDesc < 0) iDesc = cab.findIndex(function (x) { return /conta/.test(x); });
    var iDeb = cab.findIndex(function (x) { return /^debito|debitos|movimento.*deb/.test(x); });
    var iCred = cab.findIndex(function (x) { return /^credito|creditos|movimento.*cred/.test(x); });
    var iSaldo = -1; cab.forEach(function (x, k) { if (/saldo (atual|final)|saldo$|^saldo/.test(x) && !/anterior|inicial/.test(x)) iSaldo = k; });
    var reg = [];
    linhas.slice(hi + 1).forEach(function (l) {
      var desc = (l[iDesc] || '').trim(); if (!desc) return;
      var cod = iCod >= 0 ? String(l[iCod] || '').trim() : '';
      var valor, dc;
      var num = function (s) { s = String(s == null ? '' : s).trim(); var m = /([dc])\s*$/i.exec(s); var x = s.replace(/[^\d,.-]/g, ''); if (x.indexOf(',') >= 0) x = x.replace(/\./g, '').replace(',', '.'); return { v: Number(x) || 0, s: m ? m[1].toUpperCase() : '' }; };
      if (iDeb >= 0 && iCred >= 0) { var dv = num(l[iDeb]).v, cv = num(l[iCred]).v; valor = Math.abs(dv - cv); dc = dv >= cv ? 'D' : 'C'; }
      else if (iSaldo >= 0) { var sx = num(l[iSaldo]); valor = Math.abs(sx.v); dc = sx.s || (sx.v < 0 ? 'C' : 'D'); }
      else return;
      if (!valor) return;
      reg.push({ cod: cod, desc: desc, valor: valor, dc: dc });
    });
    // so contas analiticas (codigo que nao e prefixo de outro) e fora dos grupos 1 (ativo) e 2 (passivo/PL)
    var cods = reg.map(function (x) { return x.cod; }).filter(Boolean);
    reg.forEach(function (x) {
      if (x.cod) {
        var limpo = x.cod.replace(/\D/g, '');
        if (/^[12]/.test(limpo)) return;
        if (cods.some(function (c) { return c !== x.cod && c.indexOf(x.cod) === 0 && /[.\-]/.test(c.charAt(x.cod.length) || '.'); })) return;
      } else if (/a pagar|a recolher|a receber|estoque|fornecedor|clientes|banco|caixa|capital|reserva|acumulad|imobilizado|adiantamento/.test(norm(x.desc))) return;
      somarConta(o.dre, x.cod, x.desc, x.valor, x.dc);
    });
    return o;
  }

  // ---------------------------------------------------------------- consolidacao
  /** Junta os arquivos lidos: receita, composicao por NCM/servico, compras, ICMS, B2B, DRE. */
  function consolidar(lidos) {
    var porTipoMes = {}, cnpjs = {}, avisos = [];
    lidos.forEach(function (x) {
      var k = x.tipo + '|' + (x.mes || '') + '|' + (x.cnpj || '');
      if (porTipoMes[k]) { avisos.push('Arquivo repetido ignorado: ' + x.tipo + ' ' + x.mes); return; }
      porTipoMes[k] = x; if (x.cnpj) cnpjs[x.cnpj.slice(0, 8)] = (cnpjs[x.cnpj.slice(0, 8)] || 0) + 1;
    });
    var L = Object.keys(porTipoMes).map(function (k) { return porTipoMes[k]; });
    var icms = L.filter(function (x) { return x.tipo === 'icms'; }), con = L.filter(function (x) { return x.tipo === 'contrib'; });
    var ecd = L.filter(function (x) { return x.tipo === 'ecd'; }), bal = L.filter(function (x) { return x.tipo === 'balancete'; });
    if (Object.keys(cnpjs).length > 1) avisos.push('Os arquivos pertencem a mais de uma empresa (raízes de CNPJ diferentes). Confira.');
    var meses = {};
    var out = { nome: '', cnpj: '', meses: [], receitaMesMerc: {}, receitaMesServ: {}, receitaMerc: 0, receitaServ: 0, exportacao: 0, devolucoes: 0,
      compras: 0, servicosTomados: 0, icms: 0, iss: 0, pis2026: 0, cofins2026: 0, regimePisCofins: '', ncmVendas: {}, devolNcm: {}, servicosLst: {}, b2b: 0, b2c: 0,
      dre: null, fontesDre: '', avisos: avisos, arquivos: L.map(function (x) { return { tipo: x.tipo, mes: x.mes, nome: x.arquivo || '' }; }) };
    L.forEach(function (x) { if (!out.nome && x.nome) { out.nome = x.nome; out.cnpj = x.cnpj; } });
    icms.forEach(function (x) {
      meses[x.mes] = 1;
      out.receitaMesMerc[x.mes] = (out.receitaMesMerc[x.mes] || 0) + x.vendas + x.exportacao;
      out.receitaMerc += x.vendas + x.exportacao; out.exportacao += x.exportacao; out.devolucoes += x.devolucoes;
      out.compras += x.compras - x.icmsCompras; out.icms += x.icmsRecolher; out.b2b += x.b2b; out.b2c += x.b2c;   // base do credito 2027: sem ICMS
      Object.keys(x.ncmVendas).forEach(function (k) { out.ncmVendas[k] = (out.ncmVendas[k] || 0) + x.ncmVendas[k]; });
      Object.keys(x.devolNcm).forEach(function (k) { out.devolNcm[k] = (out.devolNcm[k] || 0) + x.devolNcm[k]; });
    });
    var b2bMercC = 0, b2cMercC = 0, ncmC = {}, devC = {}, devItensC = 0;
    con.forEach(function (x) {
      meses[x.mes] = 1;
      out.pis2026 += x.pis; out.cofins2026 += x.cofins; out.regimePisCofins = out.regimePisCofins || x.regimePisCofins;
      out.receitaMesServ[x.mes] = (out.receitaMesServ[x.mes] || 0) + x.servicos;
      out.receitaServ += x.servicos; out.iss += x.iss; out.servicosTomados += x.servicosTomados;
      out.b2b += x.b2bServ; out.b2c += x.b2cServ;
      Object.keys(x.servicosLst).forEach(function (k) { out.servicosLst[k] = (out.servicosLst[k] || 0) + x.servicosLst[k]; });
      b2bMercC += x.b2bMerc; b2cMercC += x.b2cMerc;
      Object.keys(x.ncmVendas).forEach(function (k) { ncmC[k] = (ncmC[k] || 0) + x.ncmVendas[k]; });
      Object.keys(x.devolNcm).forEach(function (k) { devC[k] = (devC[k] || 0) + x.devolNcm[k]; }); devItensC += x.devolItens;
      if (!icms.length) {                                     // sem EFD ICMS: receita e compras pela EFD Contribuicoes
        var rm = x.vendasItens || x.receitaF5;
        out.receitaMesMerc[x.mes] = (out.receitaMesMerc[x.mes] || 0) + rm; out.receitaMerc += rm; out.compras += x.comprasItens;
      }
    });
    // a NF-e propria nao tem itens (C170) na EFD ICMS: a composicao por NCM vem da EFD Contribuicoes
    if (!Object.keys(out.ncmVendas).length) out.ncmVendas = ncmC;
    if (!Object.keys(out.devolNcm).length) out.devolNcm = devC;
    if (!icms.length && !out.devolucoes) out.devolucoes = devItensC;
    var icmsTemPart = icms.some(function (x) { return x.b2b + x.b2c > 0; });
    if (!icmsTemPart) { out.b2b += b2bMercC; out.b2c += b2cMercC; }
    // DRE: ECD tem prioridade; depois balancetes (soma)
    if (ecd.length) { out.dre = ecd[ecd.length - 1].dre; out.fontesDre = 'ECD (I355 — resultado antes do encerramento)'; if (!ecd[ecd.length - 1].temI355) avisos.push('A ECD não tem o registro I355; preencha a DRE manualmente ou envie um balancete.'); }
    else if (bal.length) {
      var d = dreVazia();
      bal.forEach(function (b) { DRE_CAMPOS.forEach(function (k) { d[k] += b.dre[k]; }); d.contas = d.contas.concat(b.dre.contas); if (b.aviso) avisos.push('Balancete ' + (b.arquivo || '') + ': ' + b.aviso); });
      out.dre = d; out.fontesDre = 'balancete(s) (' + bal.length + ')';
    }
    out.meses = Object.keys(meses).filter(Boolean).sort();
    if (out.meses.length && out.meses.length < 12) avisos.push('Os arquivos SPED cobrem ' + out.meses.length + ' mês(es); o cálculo anualiza o período informado (× ' + (12 / out.meses.length).toFixed(2).replace('.', ',') + ').');
    out.fatorAnual = out.meses.length ? 12 / out.meses.length : 1;
    return out;
  }

  // ---------------------------------------------------------------- beneficios (NCM / servicos)
  /** Distribui a receita entre as faixas de reducao da LC 214 (k da tabela RTC.CATEGORIAS). */
  function composicaoBeneficios(idx, ncmVendas, servicosLst, exportacao) {
    var linhas = [], fx = {}, total = 0;
    var porLst = {};
    Object.keys(idx.rtc.nbsSug).forEach(function (nbs) { idx.rtc.nbsSug[nbs].lc.forEach(function (lc) { (porLst[lc] = porLst[lc] || []).push(nbs); }); });
    function faixa(cls) {
      if (!cls.gIBSCBS) return 'naoInc';
      var m = R.reducaoMedia(cls);
      return m >= 100 ? 'zero' : m >= 80 ? 'red80' : m >= 70 ? 'red70' : m >= 60 ? 'red60' : m >= 50 ? 'red50' : m >= 40 ? 'red40' : m >= 30 ? 'red30' : 'integral';
    }
    Object.keys(ncmVendas).forEach(function (ncm) {
      var v = ncmVendas[ncm]; if (v <= 0) return;
      var e = ncm.length === 8 ? R.enquadrar(idx, 'ncm', ncm) : null;
      var cls = e ? e.escolhida : idx.porCodigo['000001'], k = faixa(cls);
      fx[k] = (fx[k] || 0) + v; total += v;
      linhas.push({ tipo: 'NCM', codigo: ncm, valor: v, cClassTrib: cls.c, desc: cls.d, faixa: k, outras: e ? e.especificas.filter(function (x) { return x !== cls; }).map(function (x) { return x.c; }) : [] });
    });
    Object.keys(servicosLst).forEach(function (lc) {
      var v = servicosLst[lc]; if (v <= 0) return;
      var nbss = porLst[lc] || [], escolhas = nbss.map(function (nb) { return R.enquadrar(idx, 'nbs', nb).escolhida; });
      // conservador: se as NBS correlacionadas ao item divergem, usa a de menor reducao
      escolhas.sort(function (a, b) { return R.reducaoMedia(a) - R.reducaoMedia(b); });
      var cls = escolhas[0] || idx.porCodigo['000001'], k = faixa(cls);
      var diverg = escolhas.length > 1 && R.reducaoMedia(escolhas[0]) !== R.reducaoMedia(escolhas[escolhas.length - 1]);
      fx[k] = (fx[k] || 0) + v; total += v;
      linhas.push({ tipo: 'Serviço (LC 116)', codigo: lc || 'sem item', valor: v, cClassTrib: cls.c, desc: cls.d, faixa: k, nbs: nbss.slice(0, 5), divergente: diverg });
    });
    if (exportacao > 0) { fx.naoInc = (fx.naoInc || 0) + exportacao; total += exportacao; linhas.push({ tipo: 'Exportação (CFOP 7xxx)', codigo: '—', valor: exportacao, cClassTrib: '410004', desc: 'Exportações de bens e serviços', faixa: 'naoInc' }); }
    linhas.sort(function (a, b) { return b.valor - a.valor; });
    var pct = {}; Object.keys(fx).forEach(function (k) { pct[k] = total ? fx[k] / total : 0; });
    return { linhas: linhas, valores: fx, pct: pct, total: total };
  }

  // ---------------------------------------------------------------- calculo dos regimes
  var PRES = {
    comercio: { nome: 'Comércio e indústria', irpj: 8, csll: 12 },
    combustivel: { nome: 'Revenda de combustíveis', irpj: 1.6, csll: 12 },
    servicos: { nome: 'Serviços em geral', irpj: 32, csll: 32 },
    hospitalar: { nome: 'Serviços hospitalares e transporte de cargas', irpj: 8, csll: 12 },
    passageiros: { nome: 'Transporte de passageiros', irpj: 16, csll: 12 }
  };

  /**
   * e = {
   *   receitaMerc, receitaServ, outrasRec, devol, cmv, folha, proLabore, despCred, despSemCred, despFin, deprec,  (R$ anual)
   *   icms, iss, comprasCredito (base do credito de CBS/IBS), pctComprasSimples, credSimplesPct,
   *   composicao {k: fracao 0..1} (faixas de beneficio da receita), receitaTrimestres [4] (opcional),
   *   atividadeMerc, atividadeServ, encargos (% sobre folha), rat (%), adicoesExclusoes, prejuizo,
   *   anexoMerc, anexoServ, premissas {cbs, ibsUf, ibsMun}, regimeAtual, pctB2B
   * }
   */
  function calcular(e) {
    var p = Object.assign({ cbs: 11.3, ibsUf: 0.05, ibsMun: 0.05 }, e.premissas || {});
    var aliq = (n(p.cbs) + n(p.ibsUf) + n(p.ibsMun)) / 100;
    var recBruta = n(e.receitaMerc) + n(e.receitaServ), devol = n(e.devol), icms = n(e.icms), iss = n(e.iss);
    var res = { receitaBruta: r2(recBruta), avisos: [] };

    // ---------------- CBS/IBS (regime regular: igual no Presumido e no Real)
    var baseCbs = Math.max(0, recBruta - devol - icms - iss);
    var comp = e.composicao && Object.keys(e.composicao).length ? e.composicao : { integral: 1 };
    var somaC = 0; Object.keys(comp).forEach(function (k) { somaC += comp[k]; });
    var deb = 0, aliqEfetivaVendas = 0, porFaixa = [];
    R.CATEGORIAS.forEach(function (c) {
      var f = (comp[c.k] || 0) / (somaC || 1); if (!f) return;
      var b = baseCbs * f, a = c.k === 'naoInc' ? 0 : aliq * (1 - c.red / 100);
      deb += b * a; aliqEfetivaVendas += f * a;
      porFaixa.push({ k: c.k, nome: c.nome, fracao: f, base: r2(b), debito: r2(b * a) });
    });
    var compras = n(e.comprasCredito), ps = Math.min(1, Math.max(0, n(e.pctComprasSimples) / 100));
    var cred = compras * (1 - ps) * aliq + compras * ps * n(e.credSimplesPct) / 100;
    res.cbsIbs = { base: r2(baseCbs), debito: r2(deb), credito: r2(cred), liquido: r2(Math.max(0, deb - cred)), saldoCredor: r2(Math.max(0, cred - deb)),
      aliqEfetivaVendas: aliqEfetivaVendas, porFaixa: porFaixa };

    // ---------------- encargos sobre folha
    var enc = n(e.encargos === undefined ? 27.8 : e.encargos) / 100;
    var cppRegular = n(e.folha) * enc + n(e.proLabore) * 0.20;

    // ---------------- Lucro Presumido (trimestral, LC 224/2025)
    var pm = PRES[e.atividadeMerc || 'comercio'], pv = PRES[e.atividadeServ || 'servicos'];
    var tri = e.receitaTrimestres && e.receitaTrimestres.length === 4 ? e.receitaTrimestres : null;
    var fracDevol = recBruta ? devol / recBruta : 0;
    var lp = { irpj: 0, csll: 0, baseIrpj: 0, baseCsll: 0, acrescimoLc224: 0, trimestres: [] };
    for (var t = 0; t < 4; t++) {
      var rm = tri ? n(tri[t].merc) : n(e.receitaMerc) / 4, rs = tri ? n(tri[t].serv) : n(e.receitaServ) / 4;
      rm *= (1 - fracDevol); rs *= (1 - fracDevol);
      var rq = rm + rs, exc = rq > 1250000 ? (rq - 1250000) / rq : 0;   // parcela acima de R$ 1,25 mi no trimestre
      var bI = rm * pm.irpj / 100 * (1 + 0.1 * exc) + rs * pv.irpj / 100 * (1 + 0.1 * exc);
      var bC = rm * pm.csll / 100 * (1 + 0.1 * exc) + rs * pv.csll / 100 * (1 + 0.1 * exc);
      var acr = (rm * pm.irpj / 100 + rs * pv.irpj / 100) * 0.1 * exc;
      var outras = n(e.outrasRec) / 4;
      bI += outras; bC += outras;
      var irpj = bI * 0.15 + Math.max(0, bI - 60000) * 0.10, csll = bC * 0.09;
      lp.irpj += irpj; lp.csll += csll; lp.baseIrpj += bI; lp.baseCsll += bC; lp.acrescimoLc224 += acr;
      lp.trimestres.push({ receita: r2(rq), baseIrpj: r2(bI), irpj: r2(irpj), csll: r2(csll) });
    }
    lp.cbsIbs = res.cbsIbs.liquido; lp.cpp = cppRegular; lp.icms = icms; lp.iss = iss;
    lp.total = lp.cbsIbs + lp.irpj + lp.csll + lp.cpp + icms + iss;
    lp.margemPresumida = recBruta ? (lp.baseIrpj - n(e.outrasRec)) / (recBruta - devol) : 0;

    // ---------------- Lucro Real (anual)
    var recLiq = recBruta - devol - icms - iss;
    var custos = n(e.cmv) + n(e.despCred) + n(e.despSemCred) + n(e.despFin) + n(e.folha) + n(e.proLabore) + n(e.deprec) + cppRegular;
    var lucroContabil = recLiq + n(e.outrasRec) - custos;
    var ajustado = lucroContabil + n(e.adicoesExclusoes);
    var compensa = ajustado > 0 ? Math.min(n(e.prejuizo), ajustado * 0.30) : 0;
    var baseLR = Math.max(0, ajustado - compensa);
    var lr = { lucroContabil: lucroContabil, lucroAjustado: ajustado, compensacao: compensa, base: baseLR,
      irpj: baseLR * 0.15 + Math.max(0, baseLR - 240000) * 0.10, csll: baseLR * 0.09 };
    lr.cbsIbs = res.cbsIbs.liquido; lr.cpp = cppRegular; lr.icms = icms; lr.iss = iss;
    lr.total = lr.cbsIbs + lr.irpj + lr.csll + lr.cpp + icms + iss;
    lr.margemReal = recLiq ? lucroContabil / recLiq : 0;

    // ---------------- Simples Nacional (padrao e hibrido)
    var sn = { elegivel: recBruta <= 4800000 && !e.impedidoSimples, motivo: '' };
    if (!sn.elegivel) sn.motivo = recBruta > 4800000 ? 'Receita bruta de 12 meses acima de R$ 4,8 milhões (limite do Simples Nacional).' : 'Atividade ou condição impeditiva informada.';
    else {
      var rbt12 = recBruta;
      var fatorR = rbt12 ? (n(e.folha) + n(e.proLabore)) / rbt12 : 0;
      var anexoS = e.anexoServ || 'III';
      if (anexoS === 'III/V') anexoS = fatorR >= 0.28 ? 'III' : 'V';
      var am = R.simplesAliquotas(e.anexoMerc || 'I', rbt12), as = R.simplesAliquotas(anexoS, rbt12);
      var bm = n(e.receitaMerc) * (1 - fracDevol), bs = n(e.receitaServ) * (1 - fracDevol);
      var expFr = (comp.naoInc || 0) / (somaC || 1);                     // exportacao/imune: sem CBS/IBS no DAS
      var pctCbsIbs = function (a) { return (R.toNum(a.pCBSSN) + R.toNum(a.pIBSSN)) / 100; };
      var das = bm * R.toNum(am.aliquotaEfetiva) / 100 + bs * R.toNum(as.aliquotaEfetiva) / 100;
      var cbsDas = (bm * pctCbsIbs(am) + bs * pctCbsIbs(as)) * (1 - expFr);
      var sublim = rbt12 > 3600000;
      var partIcmsIss = 0;
      if (sublim) {   // acima de R$ 3,6 mi: ICMS e ISS fora do DAS (aproximacao pela participacao na reparticao)
        var shr = function (a, base) { var x = a.partes2027.ICMS || a.partes2027.ISS || 0n; return base * R.toNum(x) / 100; };
        partIcmsIss = shr(am, bm) + shr(as, bs);
      }
      var cppFora = anexoS === 'IV' && n(e.receitaServ) > 0 ? n(e.folha) * (0.20 + n(e.rat === undefined ? 2 : e.rat) / 100) + n(e.proLabore) * 0.20 : 0;
      sn.fatorR = fatorR; sn.anexoMerc = e.anexoMerc || 'I'; sn.anexoServ = anexoS; sn.aliqMerc = R.toNum(am.aliquotaEfetiva); sn.aliqServ = R.toNum(as.aliquotaEfetiva);
      sn.das = das - partIcmsIss; sn.cbsIbsNoDas = cbsDas; sn.cppFora = cppFora; sn.icmsIssFora = sublim ? icms + iss : 0; sn.sublimite = sublim;
      sn.total = sn.das + cppFora + sn.icmsIssFora;
      var hib = { das: sn.das - cbsDas, cbsIbs: res.cbsIbs.liquido, cppFora: cppFora, icmsIssFora: sn.icmsIssFora };
      hib.total = hib.das + hib.cbsIbs + cppFora + hib.icmsIssFora;
      sn.hibrido = hib;
    }

    // ---------------- comparativo
    var custoOper = n(e.cmv) + n(e.despCred) + n(e.despSemCred) + n(e.despFin) + n(e.folha) + n(e.proLabore) + n(e.deprec);
    var lista = [
      { id: 'LP', nome: 'Lucro Presumido', total: lp.total },
      { id: 'LR', nome: 'Lucro Real', total: lr.total }
    ];
    if (sn.elegivel) { lista.push({ id: 'SN', nome: 'Simples Nacional (CBS/IBS no DAS)', total: sn.total }); lista.push({ id: 'SNH', nome: 'Simples Nacional híbrido (CBS/IBS fora do DAS)', total: sn.hibrido.total }); }
    lista.forEach(function (x) { x.carga = recBruta ? x.total / recBruta : 0; x.resultado = recBruta + n(e.outrasRec) - devol - custoOper - x.total; });
    lista.sort(function (a, b) { return a.total - b.total; });
    res.lp = lp; res.lr = lr; res.sn = sn; res.ranking = lista; res.melhor = lista[0];
    var atual = lista.filter(function (x) { return x.id === e.regimeAtual; })[0];
    res.atual = atual || null;
    res.economia = atual ? atual.total - lista[0].total : 0;
    // ponto de equilibrio: lucro tributavel no Real que gera o mesmo IRPJ + CSLL do Presumido
    var alvo = lp.irpj + lp.csll, bEq = alvo <= 240000 * 0.24 ? alvo / 0.24 : (alvo + 24000) / 0.34;
    res.lucroEquilibrio = bEq; res.margemEquilibrio = recLiq > 0 ? bEq / recLiq : 0;
    res.pctB2B = n(e.pctB2B);
    if (sn.elegivel && res.pctB2B >= 0.5) res.avisos.push('Mais da metade das vendas é para pessoas jurídicas (' + (res.pctB2B * 100).toFixed(1).replace('.', ',') + '%): no Simples padrão o cliente só aproveita o crédito do IBS/CBS pago no DAS, o que pode reduzir a competitividade da empresa [Fonte 6] [Fonte 16]. No Simples híbrido e nos regimes Presumido/Real o cliente se credita integralmente.');
    if (sn.elegivel && sn.hibrido.total < sn.total) res.avisos.push('O Simples híbrido sai mais barato que o padrão porque, fora do DAS, a empresa aproveita as reduções de alíquota dos seus produtos/serviços e o crédito de CBS/IBS das compras; dentro do DAS a parcela de CBS/IBS é cobrada sobre toda a receita.');
    return res;
  }

  /** Receita por trimestre (grupos de 3 meses consecutivos) para o Lucro Presumido; null se nao houver 12 meses. */
  function trimestres(c) {
    if (!c.meses || c.meses.length !== 12) return null;
    var out = [];
    for (var t = 0; t < 4; t++) {
      var q = { merc: 0, serv: 0 };
      c.meses.slice(t * 3, t * 3 + 3).forEach(function (m) { q.merc += c.receitaMesMerc[m] || 0; q.serv += c.receitaMesServ[m] || 0; });
      out.push(q);
    }
    return out;
  }

  /**
   * Faturamento e devolucoes por faixa de tributacao de 2027 (media mensal), a partir das EFD de 2026.
   * A faixa de cada venda/devolucao vem do NCM (ou do item da LC 116 nos servicos); a receita sem detalhe
   * por item segue a proporcao das vendas detalhadas.
   */
  function faixasMensais(idx, c) {
    var meses = Math.max(1, c.meses.length);
    var comp = composicaoBeneficios(idx, c.ncmVendas, c.servicosLst, c.exportacao);
    var receita = c.receitaMerc + c.receitaServ, fat = {}, dev = {};
    var pctFat = comp.total ? comp.pct : { integral: 1 };
    Object.keys(pctFat).forEach(function (k) { fat[k] = receita * pctFat[k] / meses; });
    var cd = composicaoBeneficios(idx, c.devolNcm || {}, {}, 0);
    var devDet = cd.total, devTot = Math.max(c.devolucoes, devDet), resto = devTot - devDet;
    Object.keys(cd.valores).forEach(function (k) { dev[k] = (dev[k] || 0) + cd.valores[k] / meses; });
    if (resto > 0.005) Object.keys(pctFat).forEach(function (k) { dev[k] = (dev[k] || 0) + resto * pctFat[k] / meses; });
    var r = function (o) { Object.keys(o).forEach(function (k) { o[k] = r2(o[k]); }); return o; };
    return { meses: meses, faturamento: r(fat), devolucoes: r(dev), icms: r2(c.icms / meses), iss: r2(c.iss / meses),
      compras: r2((c.compras + c.servicosTomados) / meses), detalheVendas: comp, detalheDevol: cd, devolSemDetalhe: r2(resto) };
  }

  var API = { faixasMensais: faixasMensais, trimestres: trimestres, detectar: detectar, lerEfdIcms: lerEfdIcms, lerEfdContrib: lerEfdContrib, lerEcd: lerEcd, lerBalancete: lerBalancete, consolidar: consolidar,
    classificarConta: classificarConta, composicaoBeneficios: composicaoBeneficios, calcular: calcular, PRES: PRES, DRE_CAMPOS: DRE_CAMPOS, grupoSaida: grupoSaida, grupoEntrada: grupoEntrada };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  root.REGIME = API;
  // ================================================================== interface (navegador)
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var nf = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var brl = function (v) { return nf.format(v || 0); };
  var pct = function (v, c) { return ((v || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: c === undefined ? 2 : c, maximumFractionDigits: c === undefined ? 2 : c }) + '%'; };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(s) {
    s = String(s == null ? '' : s).trim().replace(/\s|R\$|%/g, '');
    if (!s) return 0;
    var neg = /^-/.test(s); s = s.replace(/^-/, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.lastIndexOf('.') > s.lastIndexOf(',') ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1 || /^[1-9]\d{0,2}\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
    var x = Number(s); return isFinite(x) ? (neg ? -x : x) : 0;
  }
  function fmtCampo(v) { return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  var IDXR = null, st = { lidos: [], cons: null, ben: null, res: null, origem: {} };
  var NOMES_REG = { LP: 'Lucro Presumido', LR: 'Lucro Real', SN: 'Simples Nacional (CBS/IBS no DAS)', SNH: 'Simples Nacional híbrido' };
  var TIPO_ARQ = { icms: 'EFD ICMS/IPI', contrib: 'EFD Contribuições', ecd: 'ECD (SPED Contábil)', balancete: 'Balancete' };

  function premissas() {
    var k = ($('#v-regime') && $('#v-regime').getAttribute('data-prem')) || 'rtc-premissas';
    try { var p = JSON.parse(localStorage.getItem(k) || 'null'); if (p) return p; } catch (e) { }
    return { cbs: 11.3, ibsUf: 0.05, ibsMun: 0.05 };
  }
  function indice() {
    if (IDXR) return Promise.resolve(IDXR);
    return fetch('data/rtc.json').then(function (r) { return r.json(); }).then(function (d) { IDXR = R.criarIndice(d); return IDXR; });
  }
  function decodificar(bytes) {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('latin1').decode(bytes); }
  }
  function linhasCsv(txt) {
    txt = txt.replace(/^﻿/, '');
    var l0 = txt.split(/\r?\n/)[0] || '', sep = (l0.match(/;/g) || []).length >= (l0.match(/,/g) || []).length ? ';' : (l0.indexOf('\t') >= 0 ? '\t' : ',');
    return txt.split(/\r?\n/).filter(function (l) { return l.trim(); }).map(function (l) { return l.split(sep).map(function (c) { return c.replace(/^"|"$/g, ''); }); });
  }
  async function lerUm(nome, bytes) {
    if (/\.zip$/i.test(nome)) {
      var ents = root.ESTOQUE.listarZip(bytes).filter(function (z) { return /\.(txt|csv|xlsx)$/i.test(z.nome) && !/__MACOSX/.test(z.nome); });
      for (var i = 0; i < ents.length; i++) await lerUm(nome + ' › ' + ents[i].nome, await ents[i].ler());
      return;
    }
    var o;
    if (/\.xlsx$/i.test(nome)) {
      var rows = await root.FORNEC.lerXlsx(bytes, root.ESTOQUE.listarZip);
      var cab = rows.length ? Object.keys(rows[0]) : [];
      o = lerBalancete([cab].concat(rows.map(function (r) { return cab.map(function (k) { return r[k]; }); })));
    } else {
      var t = decodificar(bytes), tipo = detectar(t);
      if (tipo === 'icms') o = lerEfdIcms(t);
      else if (tipo === 'contrib') o = lerEfdContrib(t);
      else if (tipo === 'ecd') o = lerEcd(t);
      else if (/\.csv$|\.txt$/i.test(nome) && /;|,|\t/.test(t.slice(0, 500))) o = lerBalancete(linhasCsv(t));
      else { st.erros.push(nome + ': arquivo não reconhecido (esperado EFD ICMS/IPI, EFD Contribuições, ECD ou balancete)'); return; }
    }
    delete o.itens; delete o.part;
    o.arquivo = nome; st.lidos.push(o);
  }
  async function receber(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    st.erros = st.erros || [];
    $('#r-msg').textContent = 'Lendo ' + files.length + ' arquivo(s)…';
    for (var i = 0; i < files.length; i++) {
      try { await lerUm(files[i].name, new Uint8Array(await files[i].arrayBuffer())); }
      catch (e) { st.erros.push(files[i].name + ': ' + e.message); }
    }
    $('#r-msg').textContent = '';
    await processar();
  }

  var CAMPOS = [
    ['receitaMerc', 'Receita bruta de vendas de mercadorias/produtos', 'Inclui exportações; sem IPI e ICMS-ST.'],
    ['receitaServ', 'Receita bruta de serviços', ''],
    ['outrasRec', 'Outras receitas (financeiras, aluguéis etc.)', 'No Presumido entram integralmente na base.'],
    ['devol', 'Devoluções, cancelamentos e descontos incondicionais', ''],
    ['icms', 'ICMS a recolher (12 meses)', 'No Simples fica dentro do DAS (até o sublimite).'],
    ['iss', 'ISS (12 meses)', ''],
    ['comprasCredito', 'Compras e serviços tomados com crédito de CBS/IBS', 'Valor sem ICMS; base do crédito em 2027.'],
    ['cmv', 'Custo das mercadorias/serviços vendidos (CMV/CPV/CSP)', ''],
    ['folha', 'Folha de salários (sem encargos)', 'Base do INSS patronal e do Fator R.'],
    ['proLabore', 'Pró-labore', ''],
    ['despCred', 'Despesas operacionais com crédito (aluguel PJ, energia, serviços PJ…)', ''],
    ['despSemCred', 'Outras despesas operacionais', 'Inclui FGTS e benefícios.'],
    ['despFin', 'Despesas financeiras', ''],
    ['deprec', 'Depreciação e amortização', ''],
    ['adicoesExclusoes', 'Adições − exclusões do LALUR (Lucro Real)', 'Ex.: multas indedutíveis (+), receitas não tributáveis (−).'],
    ['prejuizo', 'Prejuízo fiscal acumulado a compensar', 'Compensação limitada a 30% do lucro.']
  ];

  async function processar() {
    var idx = await indice();
    st.cons = consolidar(st.lidos);
    var c = st.cons, f = c.fatorAnual || 1, d = c.dre || {};
    st.ben = composicaoBeneficios(idx, c.ncmVendas, c.servicosLst, c.exportacao);
    var v = {}, o = {};
    var set = function (k, val, origem) { v[k] = val; o[k] = origem; };
    set('receitaMerc', c.receitaMerc ? c.receitaMerc * f : (d.receitaMerc || 0), c.receitaMerc ? 'EFD (C190/C170)' : d.receitaMerc ? c.fontesDre : '');
    set('receitaServ', c.receitaServ ? c.receitaServ * f : (d.receitaServ || 0), c.receitaServ ? 'EFD Contribuições (A170)' : d.receitaServ ? c.fontesDre : '');
    set('outrasRec', d.outrasRec || 0, d.outrasRec ? c.fontesDre : '');
    set('devol', c.devolucoes ? c.devolucoes * f : (d.devol || 0), c.devolucoes ? 'EFD ICMS (entradas CFOP x201/x202…)' : d.devol ? c.fontesDre : '');
    set('icms', c.icms * f, c.icms ? 'EFD ICMS (E110)' : '');
    set('iss', c.iss * f, c.iss ? 'EFD Contribuições (A100)' : '');
    var compras = (c.compras + c.servicosTomados) * f;
    set('comprasCredito', compras || ((d.cmv || 0) + (d.despCred || 0)), compras ? 'EFD (compras e serviços tomados)' : d.cmv ? 'estimado pela DRE (CMV + despesas com crédito)' : '');
    ['cmv', 'folha', 'proLabore', 'despCred', 'despSemCred', 'despFin', 'deprec'].forEach(function (k) { set(k, d[k] || 0, d[k] ? c.fontesDre : ''); });
    // preserva o que o usuario ja editou
    CAMPOS.forEach(function (cp) { var el = $('#r-' + cp[0]); if (el && el.dataset.manual) { v[cp[0]] = num(el.value); o[cp[0]] = 'informado'; } });
    st.origem = o;
    CAMPOS.forEach(function (cp) {
      var el = $('#r-' + cp[0]); if (!el) return;
      if (!el.dataset.manual) el.value = v[cp[0]] ? fmtCampo(v[cp[0]]) : '';
      var h = $('#r-o-' + cp[0]); if (h) h.textContent = o[cp[0]] ? 'Fonte: ' + o[cp[0]] : (cp[2] || 'Informe manualmente');
    });
    if (!$('#r-nome').value && c.nome) $('#r-nome').value = c.nome;
    var b2b = c.b2b + c.b2c > 0 ? c.b2b / (c.b2b + c.b2c) : null;
    if (b2b !== null && !$('#r-b2b').dataset.manual) $('#r-b2b').value = (b2b * 100).toFixed(1).replace('.', ',');
    if (c.regimePisCofins && !$('#r-atual').dataset.manual) $('#r-atual').value = c.regimePisCofins === 'cumulativo' ? 'LP' : 'LR';
    renderArquivos(); renderBeneficios();
    $('#r-dados').hidden = false;
  }

  function renderArquivos() {
    var c = st.cons, el = $('#r-arqs');
    var cont = {}; st.lidos.forEach(function (x) { cont[x.tipo] = (cont[x.tipo] || 0) + 1; });
    el.innerHTML = '<p class="hint-bloco"><strong>' + st.lidos.length + '</strong> arquivo(s) reconhecido(s): ' + Object.keys(cont).map(function (k) { return cont[k] + ' ' + TIPO_ARQ[k]; }).join(' · ') +
      (c.meses.length ? ' · período ' + c.meses[0].split('-').reverse().join('/') + ' a ' + c.meses[c.meses.length - 1].split('-').reverse().join('/') : '') +
      (c.cnpj ? ' · CNPJ ' + c.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '') + '</p>' +
      (c.avisos.concat(st.erros || []).length ? '<div class="box alert"><ul>' + c.avisos.concat(st.erros || []).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>' : '') +
      (!c.dre ? '<div class="box plain"><p>Nenhuma ECD ou balancete enviado: informe custos, folha e despesas nos campos abaixo para o cálculo do Lucro Real e do Fator R.</p></div>' : '');
  }
  var FX_NOME = {}; R.CATEGORIAS.forEach(function (c) { FX_NOME[c.k] = c.nome; });
  function renderBeneficios() {
    var b = st.ben, el = $('#r-ben');
    if (!b.total) { el.innerHTML = '<div class="box plain"><p>Sem NCM ou serviços identificados nos arquivos: o cálculo considera <strong>100% da receita com tributação integral</strong>. Envie a EFD Contribuições (C170/A170) para identificar os benefícios por produto/serviço.</p></div>'; return; }
    var resumo = Object.keys(b.valores).sort(function (x, y) { return b.valores[y] - b.valores[x]; }).map(function (k) { return '<li><strong>' + esc(FX_NOME[k] || k) + '</strong>: ' + brl(b.valores[k]) + ' (' + pct(b.pct[k], 1) + ')</li>'; }).join('');
    el.innerHTML = '<h3 class="sub">Benefícios identificados nas vendas (enquadramento automático por NCM e serviço)</h3><div class="box ok"><ul>' + resumo + '</ul></div>' +
      '<details class="ign"><summary>Ver os ' + b.linhas.length + ' código(s) analisados</summary><div class="tbl-wrap"><table><thead><tr><th>Tipo</th><th>Código</th><th>cClassTrib aplicado</th><th>Faixa</th><th class="v">Vendas (período)</th></tr></thead><tbody>' +
      b.linhas.slice(0, 400).map(function (l) { return '<tr><td>' + esc(l.tipo) + '</td><td>' + esc(l.codigo) + '</td><td>' + esc(l.cClassTrib) + ' — ' + esc(l.desc.slice(0, 80)) + (l.divergente ? ' <span class="bdg">NBS divergentes: menor redução</span>' : '') + '</td><td>' + esc(FX_NOME[l.faixa] || l.faixa) + '</td><td class="v">' + brl(l.valor) + '</td></tr>'; }).join('') +
      '</tbody></table></div></details>';
  }

  function entrada() {
    var e = {};
    CAMPOS.forEach(function (cp) { e[cp[0]] = num($('#r-' + cp[0]).value); });
    e.atividadeMerc = $('#r-atvm').value; e.atividadeServ = $('#r-atvs').value; e.anexoMerc = $('#r-anxm').value; e.anexoServ = $('#r-anxs').value;
    e.encargos = num($('#r-enc').value) || 27.8; e.pctComprasSimples = num($('#r-pcs').value); e.credSimplesPct = num($('#r-ccs').value);
    e.regimeAtual = $('#r-atual').value; e.pctB2B = num($('#r-b2b').value) / 100; e.impedidoSimples = $('#r-imped').checked;
    e.composicao = st.ben && st.ben.total ? st.ben.pct : { integral: 1 };
    e.receitaTrimestres = st.cons ? trimestres(st.cons) : null;
    // se o usuario alterou a receita, os trimestres reais deixam de valer (usa divisao igual)
    if (e.receitaTrimestres && st.cons) {
      var soma = e.receitaTrimestres.reduce(function (a, q) { return a + q.merc + q.serv; }, 0);
      if (Math.abs(soma - (e.receitaMerc + e.receitaServ)) > 1) e.receitaTrimestres = null;
    }
    e.premissas = premissas();
    return e;
  }

  function gerar() {
    var e = entrada(), msg = $('#r-msg2');
    if (!(e.receitaMerc + e.receitaServ > 0)) { msg.textContent = 'Informe a receita (envie os arquivos ou preencha os campos).'; return; }
    msg.textContent = '';
    var r = calcular(e); st.res = r; st.ent = e;
    renderRelatorio(r, e);
  }

  function linhaReg(rot, vals, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + rot + '</td>' + vals.map(function (v) { return '<td class="v">' + v + '</td>'; }).join('') + '</tr>'; }
  function renderRelatorio(r, e) {
    var nome = $('#r-nome').value.trim(), p = e.premissas, sn = r.sn, el = $('#r-res');
    var cols = [['LP', 'Lucro Presumido'], ['LR', 'Lucro Real']].concat(sn.elegivel ? [['SN', 'Simples (DAS)'], ['SNH', 'Simples híbrido']] : []);
    var get = function (id, campo) {
      if (id === 'LP') return r.lp[campo]; if (id === 'LR') return r.lr[campo];
      if (id === 'SN') return { cbsIbs: sn.cbsIbsNoDas, irpj: null, csll: null, cpp: sn.cppFora, icms: sn.sublimite ? e.icms : null, iss: sn.sublimite ? e.iss : null, das: sn.das, total: sn.total }[campo];
      return { cbsIbs: sn.hibrido.cbsIbs, irpj: null, csll: null, cpp: sn.cppFora, icms: sn.sublimite ? e.icms : null, iss: sn.sublimite ? e.iss : null, das: sn.hibrido.das, total: sn.hibrido.total }[campo];
    };
    var cel = function (v, nota) { return v === null || v === undefined ? '<span class="nome">' + (nota || 'no DAS') + '</span>' : brl(v); };
    var melhor = r.melhor, atual = r.atual;
    var h = '<h2 class="sec">Comparativo de regimes — 2027' + (nome ? ' · ' + esc(nome) : '') + ' <span class="cnt">CBS ' + String(p.cbs).replace('.', ',') + '% · IBS ' + String(Number(p.ibsUf) + Number(p.ibsMun)).replace('.', ',') + '%</span></h2>';
    h += '<div class="counts">' +
      '<div class="ct a"><div class="n" style="font-size:20px">' + esc(melhor.nome) + '</div><div class="l">Menor carga tributária estimada para 2027</div></div>' +
      '<div class="ct"><div class="n">' + brl(melhor.total) + '</div><div class="l">Tributos no ano no melhor regime (' + pct(melhor.carga) + ' da receita)</div></div>' +
      '<div class="ct b"><div class="n">' + (atual ? brl(r.economia) : '—') + '</div><div class="l">' + (atual ? (r.economia > 0.5 ? 'Economia anual estimada em relação ao regime atual (' + esc(atual.nome) + ')' : 'O regime atual (' + esc(atual.nome) + ') já é o de menor carga') : 'Regime atual não informado') + '</div></div>' +
      '<div class="ct c"><div class="n">' + pct(r.lr.margemReal, 1) + '</div><div class="l">Margem real (lucro contábil ÷ receita líquida). Equilíbrio Presumido × Real: ' + pct(r.margemEquilibrio, 1) + '</div></div></div>';
    if (atual && atual.id === melhor.id) h += '<div class="box ok"><h2><span class="ic">✅</span>Manter o regime atual</h2><p>Com os dados informados, o ' + esc(atual.nome) + ' continua sendo o regime de menor carga em 2027.</p></div>';
    else if (atual) h += '<div class="box info"><h2><span class="ic">🔄</span>Avaliar mudança para ' + esc(melhor.nome) + '</h2><p>A mudança reduziria a carga estimada em <strong>' + brl(r.economia) + '</strong> por ano (' + pct(atual.total ? r.economia / atual.total : 0, 1) + ' a menos). Confirme as premissas e o enquadramento antes de decidir.</p></div>';

    h += '<h3 class="sub">Tributos estimados para 12 meses (2027)</h3><div class="tbl-wrap"><table><thead><tr><th>Tributo</th>' + cols.map(function (c) { return '<th class="v">' + c[1] + (atual && atual.id === c[0] ? ' (atual)' : '') + '</th>'; }).join('') + '</tr></thead><tbody>';
    h += linhaReg('CBS + IBS líquidos (débitos − créditos)', cols.map(function (c) { return cel(get(c[0], 'cbsIbs')); }));
    h += linhaReg('IRPJ (com adicional)', cols.map(function (c) { return cel(get(c[0], 'irpj')); }));
    h += linhaReg('CSLL', cols.map(function (c) { return cel(get(c[0], 'csll')); }));
    h += linhaReg('INSS patronal / CPP', cols.map(function (c) { var v = get(c[0], 'cpp'); return c[0].indexOf('SN') === 0 && !v ? '<span class="nome">no DAS</span>' : brl(v); }));
    h += linhaReg('ICMS', cols.map(function (c) { return cel(get(c[0], 'icms')); }));
    h += linhaReg('ISS', cols.map(function (c) { return cel(get(c[0], 'iss')); }));
    if (sn.elegivel) h += linhaReg('DAS (demais tributos do Simples)', cols.map(function (c) { var v = get(c[0], 'das'); return v === undefined ? '—' : brl(v); }));
    h += linhaReg('Total de tributos', cols.map(function (c) { return '<strong>' + brl(get(c[0], 'total')) + '</strong>'; }), 'tot');
    h += linhaReg('Carga sobre a receita bruta', cols.map(function (c) { var x = r.ranking.filter(function (y) { return y.id === c[0]; })[0]; return pct(x.carga); }));
    h += linhaReg('Resultado após tributos (estimado)', cols.map(function (c) { var x = r.ranking.filter(function (y) { return y.id === c[0]; })[0]; return brl(x.resultado); }));
    h += '</tbody></table></div>';
    if (!sn.elegivel) h += '<p class="hint-bloco">Simples Nacional fora do comparativo: ' + esc(sn.motivo) + '</p>';

    h += '<h3 class="sub">Memória de cálculo</h3><div class="tbl-wrap"><table class="mem"><tbody>';
    h += linhaReg('Receita bruta (12 meses)', [brl(r.receitaBruta)]);
    h += linhaReg('Base de CBS/IBS 2027 (receita − devoluções − ICMS − ISS)', [brl(r.cbsIbs.base)]);
    h += linhaReg('Alíquota efetiva média de CBS+IBS nas vendas, com os benefícios identificados', [pct(r.cbsIbs.aliqEfetivaVendas)]);
    h += linhaReg('Débito de CBS/IBS · crédito sobre compras', [brl(r.cbsIbs.debito) + ' · ' + brl(r.cbsIbs.credito)]);
    if (r.cbsIbs.saldoCredor > 0) h += linhaReg('Saldo credor de CBS/IBS (créditos maiores que débitos)', [brl(r.cbsIbs.saldoCredor)]);
    h += linhaReg('Presumido: base do IRPJ · base da CSLL (presunção, trimestral)', [brl(r.lp.baseIrpj) + ' · ' + brl(r.lp.baseCsll)]);
    if (r.lp.acrescimoLc224 > 0) h += linhaReg('Presumido: acréscimo da LC 224/2025 na base do IRPJ (receita acima de R$ 1,25 mi/trimestre) [Fonte 8]', [brl(r.lp.acrescimoLc224)]);
    h += linhaReg('Real: lucro contábil · lucro ajustado (LALUR) · compensação de prejuízo', [brl(r.lr.lucroContabil) + ' · ' + brl(r.lr.lucroAjustado) + ' · ' + brl(r.lr.compensacao)]);
    h += linhaReg('Real: lucro tributável que iguala o IRPJ+CSLL do Presumido (ponto de equilíbrio)', [brl(r.lucroEquilibrio) + ' (' + pct(r.margemEquilibrio, 1) + ' da receita líquida)']);
    if (sn.elegivel) {
      h += linhaReg('Simples: alíquota efetiva do DAS — mercadorias (Anexo ' + sn.anexoMerc + ') · serviços (Anexo ' + sn.anexoServ + ')', [pct(sn.aliqMerc / 100) + ' · ' + pct(sn.aliqServ / 100)]);
      h += linhaReg('Simples: Fator R (folha + pró-labore ÷ receita)', [pct(sn.fatorR, 1)]);
      h += linhaReg('Simples: CBS/IBS dentro do DAS', [brl(sn.cbsIbsNoDas)]);
      if (sn.sublimite) h += linhaReg('Simples: receita acima do sublimite de R$ 3,6 mi — ICMS e ISS recolhidos fora do DAS', [brl(sn.icmsIssFora)]);
    }
    h += '</tbody></table></div>';

    var av = r.avisos.slice();
    if (r.cbsIbs.saldoCredor > 0) av.push('Os créditos de CBS/IBS superam os débitos: saldo credor de ' + brl(r.cbsIbs.saldoCredor) + ' no ano, compensável ou ressarcível conforme a LC 214/2025.');
    if (r.lr.lucroContabil < 0) av.push('A DRE indica prejuízo contábil: no Lucro Real não há IRPJ/CSLL e o prejuízo pode ser compensado em anos seguintes (limite de 30%).');
    if (av.length) h += '<div class="box alert"><h2><span class="ic">⚠️</span>Pontos de atenção</h2><ul>' + av.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>';

    h += '<div class="box plain"><h2><span class="ic">📅</span>Prazos para a decisão</h2><ul>' +
      '<li><strong>Lucro Presumido ou Real:</strong> a opção é feita com o pagamento da primeira quota ou parcela do IRPJ do ano-calendário (vencimento no fim de fevereiro de 2027, referente a janeiro) e vale para o ano todo.</li>' +
      '<li><strong>Simples Nacional:</strong> opção em janeiro, até o último dia útil do mês, para empresas já em atividade.</li>' +
      '<li><strong>Simples híbrido (CBS/IBS fora do DAS):</strong> opção semestral; para o 2º semestre de 2027, a janela é março de 2027 [Fonte 6].</li>' +
      '<li><strong>Documentos fiscais:</strong> Simples Nacional na NF-e/NFS-e em duas etapas, 01/01/2027 e 01/03/2027 [Fonte 15].</li></ul></div>';

    h += '<div class="method"><h3>Premissas e fontes</h3><ul>' +
      '<li>CBS a ' + String(p.cbs).replace('.', ',') + '% (alíquota de referência de 2027 aprovada pelo TCU) e IBS a 0,1% [Fonte 4]; benefícios por NCM/NBS pelas tabelas oficiais de cClassTrib [Fonte 3] [Fonte 5], com motor da Calculadora RTC da Receita Federal [Fonte 12].</li>' +
      '<li>PIS e Cofins extintos em 2027; ICMS e ISS fora da base da CBS/IBS; CBS/IBS calculados “por fora” e não cumulativos para Presumido e Real.</li>' +
      '<li>Presunção do IRPJ/CSLL (Lei 9.249/1995): mercadorias ' + String(PRES[e.atividadeMerc].irpj).replace('.', ',') + '%/' + PRES[e.atividadeMerc].csll + '%; serviços ' + PRES[e.atividadeServ].irpj + '%/' + PRES[e.atividadeServ].csll + '%; acréscimo de 10% sobre a receita acima de R$ 5 mi/ano (LC 224/2025) [Fonte 8]. IRPJ 15% + adicional 10% (R$ 20 mil/mês); CSLL 9%.</li>' +
      '<li>Lucro Real anual: lucro contábil ± LALUR, compensação de prejuízo até 30%. INSS patronal de ' + String(e.encargos).replace('.', ',') + '% sobre a folha e 20% sobre o pró-labore.</li>' +
      '<li>Simples Nacional: tabelas da LC 123/2006 com a partilha de CBS/IBS de 2027; no Simples sem a opção pelo regime regular, o adquirente só se credita do valor pago no DAS [Fonte 16]; o Simples não acaba e passa a ter a modalidade híbrida [Fonte 6].</li>' +
      '<li>Não inclui: Imposto Seletivo, regimes específicos (combustíveis, financeiro, imóveis), JCP, incentivos regionais e ICMS-ST. Valores dos SPED anualizados quando o período tem menos de 12 meses.</li></ul>' +
      '<h3>Fontes do caderno citadas</h3><ul class="fontes">' +
      '<li>[Fonte 3] Informe Técnico 2025.002 — Grupo UB, CST-IBS/CBS e cClassTrib.</li>' +
      '<li>[Fonte 4] TCU aprova alíquota de referência da CBS de 11,3% — <a href="https://agenciabrasil.ebc.com.br/economia/noticia/2026-10/tcu-aprova-calculo-da-aliquota-de-referencia-da-cbs-em-113" target="_blank" rel="noopener">Agência Brasil</a>; <a href="https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm" target="_blank" rel="noopener">LC 214/2025</a>.</li>' +
      '<li>[Fonte 5] Informe Técnico 2025.002 v1.71 e Ato Técnico Conjunto nº 10/2026 — <a href="https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=WYEtloOC2CQ=" target="_blank" rel="noopener">Portal da NF-e</a>.</li>' +
      '<li>[Fonte 6] Simples Nacional e Simples Híbrido na Reforma Tributária — <a href="https://blog.esimplesauditoria.com.br/cbs-ibs-por-dentro-ou-por-fora-do-das/" target="_blank" rel="noopener">eSimples Auditoria</a>.</li>' +
      '<li>[Fonte 8] LC 224/2025, Decreto 12.808/2025, Portaria MF 3.278/2025 e IN RFB 2.305/2025 (redução de benefícios fiscais).</li>' +
      '<li>[Fonte 12] Plataforma RTC — Calculadora de Tributos e dados abertos.</li>' +
      '<li>[Fonte 15] Calendário das notas fiscais até 2027.</li>' +
      '<li>[Fonte 16] LC 214/2025, art. 47, § 9º — crédito do adquirente de optante do Simples.</li></ul>' +
      '<div class="disc">Estimativa para apoio à decisão. Depende da veracidade e da completude dos arquivos e valores informados, das alíquotas efetivamente fixadas e de regulamentação posterior. Não substitui o planejamento tributário individual por profissional habilitado.</div></div>';
    h += '<div class="btns no-print"><button class="btn sec" type="button" onclick="window.print()">Imprimir / salvar PDF</button><button class="btn sec" type="button" id="r-csv">Exportar comparativo (CSV)</button></div>';
    el.innerHTML = h; el.hidden = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function exportarCsv() {
    var r = st.res; if (!r) return;
    var br = function (v) { return (v || 0).toFixed(2).replace('.', ','); };
    var l = ['regime;cbs_ibs;irpj;csll;inss_cpp;icms;iss;das;total;carga_pct;resultado_apos_tributos'];
    l.push(['Lucro Presumido', br(r.lp.cbsIbs), br(r.lp.irpj), br(r.lp.csll), br(r.lp.cpp), br(r.lp.icms), br(r.lp.iss), '', br(r.lp.total)].join(';'));
    l.push(['Lucro Real', br(r.lr.cbsIbs), br(r.lr.irpj), br(r.lr.csll), br(r.lr.cpp), br(r.lr.icms), br(r.lr.iss), '', br(r.lr.total)].join(';'));
    if (r.sn.elegivel) {
      l.push(['Simples Nacional', br(r.sn.cbsIbsNoDas), '', '', br(r.sn.cppFora), '', '', br(r.sn.das), br(r.sn.total)].join(';'));
      l.push(['Simples híbrido', br(r.sn.hibrido.cbsIbs), '', '', br(r.sn.cppFora), '', '', br(r.sn.hibrido.das), br(r.sn.hibrido.total)].join(';'));
    }
    l = l.map(function (x, i) { if (!i) return x; var id = ['LP', 'LR', 'SN', 'SNH'][i - 1], rk = r.ranking.filter(function (y) { return y.id === id; })[0]; return x + ';' + br(rk.carga * 100) + ';' + br(rk.resultado); });
    var blob = new Blob(['﻿' + l.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'comparativo-regimes-2027.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function initUi() {
    var sec = $('#v-regime'); if (!sec) return;
    var drop = $('#r-drop');
    $('#r-files').addEventListener('change', function (ev) { receber(ev.target.files).then(function () { ev.target.value = ''; }); });
    drop.addEventListener('click', function () { $('#r-files').click(); });
    drop.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('#r-files').click(); } });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (ev) { ev.preventDefault(); drop.classList.add('on'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (ev) { ev.preventDefault(); drop.classList.remove('on'); }); });
    drop.addEventListener('drop', function (ev) { receber(ev.dataTransfer.files); });
    $('#r-limpar').addEventListener('click', function () { st.lidos = []; st.erros = []; st.cons = null; $('#r-dados').hidden = true; $('#r-res').hidden = true; $('#r-arqs').innerHTML = ''; $$('#v-regime input[data-manual]').forEach(function (i) { delete i.dataset.manual; }); });
    $('#r-manual').addEventListener('click', function () { if (!st.cons) { st.cons = consolidar([]); st.ben = { linhas: [], valores: {}, pct: {}, total: 0 }; } renderArquivos(); renderBeneficios(); $('#r-dados').hidden = false; $('#r-receitaMerc').focus(); });
    $('#v-regime').addEventListener('input', function (ev) { if (ev.target.matches('input.num, #r-b2b, select')) ev.target.dataset.manual = '1'; });
    $('#r-atual').addEventListener('change', function () { $('#r-atual').dataset.manual = '1'; });
    $('#r-gerar').addEventListener('click', gerar);
    $('#r-res').addEventListener('click', function (ev) { if (ev.target.id === 'r-csv') exportarCsv(); });
    var g = $('#r-campos');
    g.innerHTML = CAMPOS.map(function (c) { return '<div class="field"><label for="r-' + c[0] + '">' + esc(c[1]) + '</label><input id="r-' + c[0] + '" class="num" inputmode="decimal" placeholder="0,00"><span class="hint" id="r-o-' + c[0] + '">' + esc(c[2]) + '</span></div>'; }).join('');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUi); else initUi();
})(typeof window !== 'undefined' ? window : globalThis);
