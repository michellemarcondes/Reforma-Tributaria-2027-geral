// Compara o calculo de CBS/IBS do Simples Nacional (motor do site) com a API oficial do Simples,
// rota nao-assistida: o par pCBSSN/pIBSSN de cada anexo vem do motor do site (LC 123 + partilha 2027).
// Uso: node tests/compare-api-simples.js [http://localhost:8082/api]
const RTC = require('../assets/js/engine.js');
const URL = (process.argv[2] || 'http://localhost:8082/api') + '/calculadora/observabilidade/simples-nacional/nao-assistido';
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const ATIV = { I: '01', II: '03', III: '07', IV: '14', V: '09' };
const s = (v, c) => RTC.toStr(v, c);
(async () => {
  let ok = 0, div = 0, n = 0; const ex = [];
  for (let i = 0; i < 400; i++) {
    const rbt12 = (Math.floor(rnd() * 480000000) / 100 + 1000).toFixed(2);
    const linha = { fatorR: false, impedimentoSublimite: false };
    const al = {};
    for (const a of ['I', 'II', 'III', 'IV', 'V']) {
      const r = RTC.simplesAliquotas(a, rbt12);
      al[a] = r;
      linha['anexo' + a] = { pCBSSN: s(r.pCBSSN, 10), pIBSSN: s(r.pIBSSN, 10) };
    }
    const nfse = rnd() < 0.5;
    // combinacoes validas: NF-e -> Anexo I (01), II (03); NFS-e -> III (07), IV (14), V (09)
    const anexo = nfse ? ['III', 'IV', 'V'][Math.floor(rnd() * 3)] : ['I', 'II'][Math.floor(rnd() * 2)];
    const cativ = nfse ? { III: '07', IV: '14', V: '09' }[anexo] : { I: '01', II: '03', III: '11' }[anexo];
    const base = (Math.floor(rnd() * 2e7) / 100 + 1).toFixed(2);
    const op = nfse
      ? { id: 'x', versao: '3.0.0', data: '2027-03-15', tpDoc: '91', opSimpNac: '3', regApIBSCBSSN: '1', regApTribSN: '1', aliquotasEfetivas: linha,
          itens: [{ numero: 1, cClassTrib: '000001', baseCalculo: base, cAtivSN: cativ, NBS: '115021000', tpRBSN: '1', tribISSQN: '1', tpRetISSQN: '1' }] }
      : { id: 'x', versao: '3.0.0', data: '2027-03-15', tpDoc: '55', CRT: '1', aliquotasEfetivas: linha,
          itens: [{ numero: 1, cAtivSN: cativ, cClassTrib: '000001', baseCalculo: base, valorImpostoSeletivo: '0.00', NCM: '84713012', tpRBSN: '1' }] };
    const anexoUsado = anexo;
    const resp = await (await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(op) })).json();
    const o = resp.objetos && resp.objetos[0];
    n++;
    if (!o || !o.tribCalc) { div++; if (ex.length < 6) ex.push({ op: { tpDoc: op.tpDoc, anexo: anexoUsado }, resp: JSON.stringify(resp).slice(0, 600) }); continue; }
    const t = o.tribCalc;
    const r = al[anexoUsado];
    const me = RTC.calcularItemSimples(base, s(r.pCBSSN, 10), s(r.pIBSSN, 10), nfse ? 2 : null);
    const vC = t.vCBSSN, vI = t.vIBSSN;
    if (Number(vC) === Number(s(me.vCBS, 2)) && Number(vI) === Number(s(me.vIBS, 2))) ok++;
    else { div++; if (ex.length < 6) ex.push({ base, anexo: anexoUsado, nfse, api: t, me: { vCBS: s(me.vCBS, 2), vIBS: s(me.vIBS, 2) } }); }
  }
  console.log({ casos: n, iguais: ok, divergentes: div });
  ex.forEach(e => console.log(JSON.stringify(e)));
  process.exit(div ? 1 : 0);
})();
