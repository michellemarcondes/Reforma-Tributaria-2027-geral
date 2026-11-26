// Compara o motor JS do site com a API oficial da Receita (regime geral) rodando localmente.
// Uso: node tests/compare-api.js [http://localhost:8080/api/calculadora]
const RTC = require('../assets/js/engine.js');
const rtc = require('../data/rtc.json'), ncm = require('../data/ncm.json'), nbs = require('../data/nbs.json');
const URL = (process.argv[2] || 'http://localhost:8080/api/calculadora') + '/observabilidade/regime-geral';
const idx = RTC.criarIndice(rtc);
const ALIQ = { cbs: 11.3, ibsUf: 0.05, ibsMun: 0.05 };
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const randBase = () => (Math.floor(rnd() * 5e6) / 100 + 0.01).toFixed(2);

async function rodar(tipo, codigo, cls, base, tpDoc, vIS) {
  const item = { numero: 1, cst: cls.cst, cClassTrib: cls.c, baseCalculo: Number(base), quantidade: 1, unidade: 'UN',
    aliquotasNominais: { cbs: ALIQ.cbs, ibsEstadual: ALIQ.ibsUf, ibsMunicipal: ALIQ.ibsMun } };
  item[tipo] = codigo;
  if (vIS) { // produto sujeito ao IS: BC do IS = base; IS informado = calculado (10%)
    item.impostoSeletivo = { cst: '000', cClassTrib: '000001', baseCalculo: Number(base), quantidade: 1, unidade: 'UN', impostoInformado: Number(vIS) };
    item.aliquotasNominais.impostoSeletivo = { adValorem: 10 };
    delete item.baseCalculo;
  }
  const op = { id: 'x', versao: '1.0.0', dhFatoGerador: '2027-03-10T10:00:00-03:00', municipio: 3509502, uf: 'SP', tpDoc, itens: [item] };
  const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(op) });
  return r.json();
}
const s2 = v => RTC.toStr(v, 2), s4 = v => RTC.toStr(v, 4);

(async () => {
  const stats = { casos: 0, aplic_ok: 0, aplic_div: 0, valor_ok: 0, valor_div: 0, api_outros: {} };
  const divs = [];
  // amostra: NCMs dos anexos + NCMs aleatorios; NBS dos anexos + aleatorios
  const ncm8 = ncm.filter(r => r[0].length === 8).map(r => r[0]);
  const nbs9 = nbs.filter(r => r[0].length === 9).map(r => r[0]);
  const amostraNcm = new Set(), amostraNbs = new Set();
  rtc.ncmA.forEach(r => { const m = ncm8.filter(c => c.startsWith(r[0])); if (m.length) amostraNcm.add(m[Math.floor(rnd() * m.length)]); (r[2] || []).forEach(e => { const x = ncm8.find(c => c.startsWith(e)); if (x) amostraNcm.add(x); }); });
  for (let i = 0; i < 150; i++) amostraNcm.add(ncm8[Math.floor(rnd() * ncm8.length)]);
  rtc.nbsA.forEach(r => { const m = nbs9.filter(c => c.startsWith(r[0])); if (m.length) amostraNbs.add(m[Math.floor(rnd() * m.length)]); });
  for (let i = 0; i < 80; i++) amostraNbs.add(nbs9[Math.floor(rnd() * nbs9.length)]);
  const especiais = rtc.classes.filter(c => c.anexoNcm || c.anexoNbs);
  const gerais = rtc.classes;
  const jobs = [];
  for (const cod of amostraNcm) {
    const ap = RTC.classificacoesPara(idx, 'ncm', cod);
    const okSet = new Set([...ap.especificas, ...ap.gerais].map(c => c.c));
    // testa todas as especiais com anexo NCM + 6 gerais aleatorias
    const testar = especiais.filter(c => c.docs.includes('NF-e') && c.anexoNcm);
    for (let i = 0; i < 6; i++) testar.push(ap.gerais[Math.floor(rnd() * ap.gerais.length)]);
    testar.forEach(c => c && jobs.push({ tipo: 'ncm', cod, c, esperaOk: okSet.has(c.c), tpDoc: 55 }));
  }
  for (const cod of amostraNbs) {
    const ap = RTC.classificacoesPara(idx, 'nbs', cod);
    const okSet = new Set([...ap.especificas, ...ap.gerais].map(c => c.c));
    const testar = especiais.filter(c => c.docs.includes('NFS-e') && c.anexoNbs);
    for (let i = 0; i < 6; i++) testar.push(ap.gerais[Math.floor(rnd() * ap.gerais.length)]);
    testar.forEach(c => c && jobs.push({ tipo: 'nbs', cod, c, esperaOk: okSet.has(c.c), tpDoc: 91 }));
  }
  console.log('casos a testar:', jobs.length);
  const CONC = 16; let k = 0;
  async function worker() {
    while (k < jobs.length) {
      const j = jobs[k++]; const base = randBase();
      const vIS = j.tipo === 'ncm' && RTC.sujeitoIS(idx, j.cod) ? (Math.round(Number(base) * 10) / 100).toFixed(2) : null;
      let resp; try { resp = await rodar(j.tipo, j.cod, j.c, base, j.tpDoc, vIS); } catch (e) { stats.api_outros.erroRede = (stats.api_outros.erroRede || 0) + 1; continue; }
      stats.casos++;
      const o = resp.objetos && resp.objetos[0];
      const est = o ? o.estadoItem : (resp.title || 'SEM_OBJETO');
      const apiOk = est === 'CALCULADO' || est === 'CALCULO_SIMULADO';
      if (!apiOk && est !== 'INCONSISTENCIA_ENTRADA') { stats.api_outros[est] = (stats.api_outros[est] || 0) + 1; divs.push({ j: [j.tipo, j.cod, j.c.c], est, resp: JSON.stringify(resp).slice(0, 400) }); continue; }
      if (apiOk === j.esperaOk) stats.aplic_ok++; else { stats.aplic_div++; divs.push({ tipo: 'aplicabilidade', j: [j.tipo, j.cod, j.c.c], api: est, err: o && o.erros && o.erros[0] && o.erros[0].detail }); }
      if (!apiOk) continue;
      const mine = RTC.calcularItemRegular(vIS ? (Number(base) + Number(vIS)).toFixed(2) : base, j.c, ALIQ);
      if (vIS) stats.comIS = (stats.comIS || 0) + 1;
      const ib = o.tribCalc && o.tribCalc.IBSCBS;
      const g = ib && ib.gIBSCBS;
      const api = g ? { vBC: g.vBC, cbs: g.gCBS.vCBS, uf: g.gIBSUF.vIBSUF, mun: g.gIBSMun.vIBSMun,
        ecbs: g.gCBS.gRed ? g.gCBS.gRed.pAliqEfet : g.gCBS.pCBS, pdif: g.gCBS.gDif ? g.gCBS.gDif.vDif : null } : null;
      const me = mine.semDestaque ? null : { vBC: s2(mine.vBC), cbs: s2(mine.tributos.cbs.devido), uf: s2(mine.tributos.ibsUf.devido), mun: s2(mine.tributos.ibsMun.devido) };
      const igual = (!api && !me) || (api && me && Number(api.vBC) === Number(me.vBC) && Number(api.cbs) === Number(me.cbs) && Number(api.uf) === Number(me.uf) && Number(api.mun) === Number(me.mun));
      if (igual) stats.valor_ok++; else { stats.valor_div++; divs.push({ tipo: 'valor', j: [j.tipo, j.cod, j.c.c, base], api, me, raw: JSON.stringify(ib).slice(0, 500) }); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log(JSON.stringify(stats, null, 1));
  const agg={}; divs.forEach(d=>{const k=(d.tipo||d.est)+" "+d.j[2]+" "+(d.api||"")+" "+String(d.err||d.resp||"").slice(0,160); agg[k]=(agg[k]||0)+1}); Object.entries(agg).sort((a,b)=>b[1]-a[1]).slice(0,60).forEach(e=>console.log(e[1],e[0]));
  process.exit(stats.aplic_div || stats.valor_div ? 1 : 0);
})();
