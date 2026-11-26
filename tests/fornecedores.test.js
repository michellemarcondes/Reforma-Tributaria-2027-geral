// Testes do motor da aba Fornecedores. Uso: node tests/fornecedores.test.js <planilha_da_skill.xlsx> [--rede]
const F = require('../assets/js/fornecedores.js'), E = require('../assets/js/estoque.js'), fs = require('fs');
const ok = (c, m) => { if (!c) { console.error('FALHOU: ' + m); process.exit(1); } console.log('ok -', m); };
(async () => {
  ok(F.cnpjValido('00.000.000/0001-91') && !F.cnpjValido('00000000000192') && !F.cnpjValido('11111111111111'), 'validação de dígitos verificadores do CNPJ');
  const l = F.lerLista('Fornecedor;CNPJ;Valor\nDistribuidora Alfa SA;00.000.000/0001-91;125.000,00\n33000167000101\tPETROBRAS\t1.000\nErrado;00000000000192\nRepetido;00000000000191\n60701190000104, Itau');
  ok(l.itens.length === 3 && l.itens[0].nome === 'Distribuidora Alfa SA' && l.itens[0].valor === 125000 && l.itens[1].nome === 'PETROBRAS' && l.itens[1].valor === 1000 && l.itens[2].nome === 'Itau', 'lista colada: ponto e vírgula, tabulação (Excel) e vírgula; nome e valor reconhecidos');
  ok(l.invalidos.length === 1 && l.duplicados === 1, 'CNPJ inválido e duplicado avisados');
  const hoje = '2026-11-26';
  const nao = F.normalizarCadastro({ razao_social: 'X', descricao_situacao_cadastral: 'ATIVA', opcao_pelo_simples: null, opcao_pelo_mei: null }, 't', hoje);
  const sn = F.normalizarCadastro({ razao_social: 'Y', descricao_situacao_cadastral: 'ATIVA', opcao_pelo_simples: true, data_opcao_pelo_simples: '2020-01-01', data_exclusao_do_simples: null, opcao_pelo_mei: false }, 't', hoje);
  const exc = F.normalizarCadastro({ razao_social: 'Z', descricao_situacao_cadastral: 'ATIVA', opcao_pelo_simples: false, data_opcao_pelo_simples: '2015-01-01', data_exclusao_do_simples: '2022-12-31' }, 't', hoje);
  const mei = F.normalizarCadastro({ razao_social: 'W', descricao_situacao_cadastral: 'ATIVA', opcao_pelo_simples: true, opcao_pelo_mei: true }, 't', hoje);
  const baixada = F.normalizarCadastro({ razao_social: 'B', descricao_situacao_cadastral: 'BAIXADA', opcao_pelo_simples: null }, 't', hoje);
  const C = F.CRED;
  ok(F.classificar({ cad: nao }).credito === C.INT, 'não optante do Simples → crédito integral');
  ok(F.classificar({ cad: exc }).credito === C.INT && !exc.simples && exc.dataExclusaoSimples === '2022-12-31', 'excluído do Simples em 2022 → regime regular, crédito integral');
  ok(F.classificar({ cad: sn }).credito === C.PEND, 'optante do Simples sem a consulta de 2027 → pendente');
  ok(F.classificar({ cad: sn, opcao: 'optou' }).credito === C.INT, 'Simples + opção pelo regime regular (híbrido) → integral');
  ok(F.classificar({ cad: sn, opcao: 'naoOptou' }).credito === C.LIM && F.classificar({ cad: sn, opcao: 'cancelada' }).credito === C.LIM, 'Simples sem opção ou opção cancelada → limitado ao DAS');
  ok(F.classificar({ cad: sn, opcao: 'exclusao' }).credito === C.INT, 'exclusão do Simples agendada → integral (com observação)');
  ok(F.classificar({ cad: mei }).credito === C.LIM, 'MEI → limitado');
  ok(/BAIXADA/.test(F.classificar({ cad: baixada }).obs), 'CNPJ baixado gera alerta');
  ok(F.classificar({ cad: { erro: 'x' } }).credito === C.ATEN, 'falha de consulta → verificar');
  // planilha gerada pela skill consulta-regime-hibrido-cbs-ibs
  const linhas = await F.lerXlsx(new Uint8Array(fs.readFileSync(process.argv[2])), E.listarZip);
  const r = F.lerPlanilhaSkill(linhas);
  ok(r['11111111000191'].opcao === 'optou' && r['22222222000191'].opcao === 'naoOptou' && r['33333333000191'].opcao === 'cancelada' && r['44444444000191'].opcao === 'exclusao' && !r['55555555000191'].simples, 'planilha .xlsx da skill lida: híbrido, sem opção, cancelada, exclusão e fora do Simples');
  // fetch simulado: limite (429) e reserva
  let chamadas = [];
  const fake = async (url) => { chamadas.push(url); if (url.includes('brasilapi')) return { status: 429, ok: false }; return { status: 200, ok: true, json: async () => ({ razao_social: 'RESERVA SA', descricao_situacao_cadastral: 'ATIVA', opcao_pelo_simples: null }) }; };
  const rr = await F.consultarCnpj('00000000000191', fake);
  ok(rr.razao === 'RESERVA SA' && rr.fonte === 'Minha Receita' && chamadas.filter(u => u.includes('brasilapi')).length === 3, 'BrasilAPI com limite (429): 3 tentativas e uso da fonte reserva');
  const r404 = await F.consultarCnpj('00000000000191', async () => ({ status: 404, ok: false }));
  ok(/não encontrado/.test(r404.erro), 'CNPJ inexistente (404) reportado');
  if (process.argv.includes('--rede')) {
    // a BrasilAPI recusa o user-agent padrao do Node; navegadores enviam o seu proprio
    const real = await F.consultarCnpj('00000000000191', (u, o) => fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (teste)', Accept: 'application/json' } }));
    ok(real.razao === 'BANCO DO BRASIL SA' && real.simples === false && real.fonte === 'BrasilAPI', 'consulta real na BrasilAPI: Banco do Brasil, não optante');
  }
  console.log('\nTESTES DOS FORNECEDORES PASSARAM');
})();
