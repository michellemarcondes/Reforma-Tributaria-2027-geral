# Calculadora CBS e IBS 2027

**Acesse o site:** https://michellemarcondes.github.io/Reforma-Tributaria-2027-geral/

Site estático (HTML/CSS/JS, sem servidor) para simular a **CBS** e o **IBS** de 2027
(Reforma Tributária do Consumo — LC 214/2025), com o motor de cálculo e as tabelas oficiais da
**Calculadora RTC da Receita Federal**:

- [ReceitaFederal/calculadora-rtc-regime-regular](https://github.com/ReceitaFederal/calculadora-rtc-regime-regular)
- [ReceitaFederal/calculadora-rtc-simples-nacional](https://github.com/ReceitaFederal/calculadora-rtc-simples-nacional)

## Funcionalidades

1. **Simulador da empresa** — nome da empresa (sem CNPJ), regime (Lucro Real, Lucro Presumido,
   Simples Nacional padrão ou Simples optante pelo regime regular de IBS/CBS), **faturamento por
   faixa de tributação** (integral; reduções de 30%, 40%, 50%, 60%, 70%, 80%; alíquota zero;
   isento/imune/exportação) **e devoluções da mesma faixa**, com o faturamento bruto somado
   automaticamente; ICMS e ISS rateados entre as faixas; compras com crédito. **Preenchimento pela EFD**:
   envie a EFD ICMS/IPI e a EFD Contribuições de 2026 e cada venda/devolução é classificada pelo NCM/NBS
   como seria tributada em 2027 (média mensal). No Simples padrão, seguindo a
   calculadora oficial, as reduções não alteram o DAS; só a faixa isenta/exportação fica fora. Mostra a receita líquida (base), débitos, créditos, CBS e IBS a recolher, carga efetiva
   e comparativo com o PIS/Cofins de 2026.
2. **Painel do contador** — vários clientes de uma vez (digitação ou importação de CSV),
   recálculo instantâneo, totais da carteira, exportação do resultado em CSV e impressão/PDF.
   Os dados ficam somente no navegador (localStorage).
3. **Simulador de nota fiscal** — **a partir do XML de uma NF-e de hoje**: retira do preço o ICMS (+FCP)
   destacado e o PIS/Cofins pelas alíquotas da empresa (regime sugerido pelo XML; CST monofásico/alíquota
   zero sem PIS/Cofins), e o IPI e o ICMS-ST cobrados por fora, chegando ao **valor líquido** que a empresa
   recebe; sobre ele calcula a CBS e o IBS de 2027 por fora (classificação automática pelo NCM) e o ICMS por
   dentro com a alíquota do XML, em dois cenários — CBS/IBS **compondo ou não a base do ICMS** (opção
   marcável; hoje compõem em todos os estados). Ou, manualmente: valor da nota, NCM (NF-e) ou NBS (NFS-e) com busca por código,
   descrição ou item da LC 116. O enquadramento é **automático**: o site identifica, pelas tabelas
   oficiais (anexos da LC 214/2025 e correlação NBS × cClassTrib), se o código tem redução de 100%,
   60%, 40%, 30% etc. e já calcula a CBS, o IBS estadual e o IBS municipal com essa redução.
   Benefícios que dependem de condição do comprador (ex.: venda a órgão público) não são aplicados
   sozinhos, mas ficam listados para seleção.

Campos numéricos aceitam qualquer formato: 2000, 2.000, 2.000,00, 2000,5 ou 1,234.56.

4. **Crédito de estoque** — crédito presumido de CBS sobre o estoque de abertura de 2027 (art. 381 da
   LC 214/2025). **Projeção do inventário de 31/12/2026**: com no mínimo 2 meses de EFD de 2026,
   calcula um pseudo-inventário item a item (entradas − saídas a custo, mês a mês) e projeta até dezembro
   pela média de no mínimo 2 meses, com relatório mês a mês (partidas opcionais: XMLs, valor informado
   ou Bloco H). A pessoa envia os XMLs das notas de compra (arquivos, pasta inteira ou .zip, sem
   limite; lidos no próprio navegador). O site separa o que gera crédito (revenda/insumo, ST e
   monofásico, importação) do que não gera (alíquota zero/isenção/suspensão, uso e consumo,
   imobilizado, transferência, devolução, remessa, notas canceladas e duplicadas), calcula 9,25% sobre o
   custo de aquisição do estoque, permite ajustar o inventário de 31/12/2026 (item a item, por % ou
   importando CSV) e monta o cronograma das 12 parcelas a partir do mês de apropriação (até junho/2027).

5. **Fornecedores** — diz quais fornecedores vão gerar crédito de CBS/IBS em 2027. A lista (colada,
   CSV/TXT/XLSX ou extraída das notas da aba de estoque) é consultada automaticamente na base pública
   de CNPJ (BrasilAPI, reserva Minha Receita): situação cadastral, Simples e MEI. Para os optantes do
   Simples, a opção pelo regime regular de 2027 é confirmada no Consulta Optantes da Receita (com
   captcha; o site abre a consulta) ou importada da planilha gerada pela consulta de regime híbrido.
   Resultado: crédito integral × limitado ao DAS, com resumo por quantidade e valor e exportação CSV.

6. **Melhor regime 2027** — comparativo Lucro Presumido × Lucro Real × Simples Nacional (padrão e
   híbrido). Lê, no navegador, 12 meses de EFD ICMS/IPI e EFD Contribuições e a ECD ou balancetes
   (CSV/XLSX), soltos ou em .zip; identifica os benefícios da LC 214/2025 por NCM e por serviço
   (LC 116 → NBS), calcula a CBS/IBS com créditos, monta a DRE (editável) e calcula IRPJ/CSLL
   (presunção trimestral com a LC 224/2025; lucro real com LALUR e prejuízo até 30%), INSS patronal,
   ICMS/ISS e DAS (sublimite, Fator R, Anexo IV). Relatório com ranking, economia frente ao regime
   atual, margem real × ponto de equilíbrio, alerta de vendas B2B, prazos de opção e fontes.

Premissas padrão (editáveis na aba *Premissas*): **CBS 11,3%**, **IBS 0,05% estadual + 0,05% municipal**.

## Como o cálculo foi portado e validado

- `tools/export_data.py` lê o banco SQLite oficial (gerado pelo flyway do repositório da Receita)
  e grava `data/rtc.json` (classificações, reduções, vínculos NCM/NBS dos anexos, NCMs sujeitos
  ao IS), `data/ncm.json` e `data/nbs.json`.
- `assets/js/engine.js` replica `CalculoCbsIbsService` e `ArredondamentoUtils` (aritmética decimal
  exata, arredondamento *half-even*, alíquotas com 4 casas, base com 2 casas), a base de cálculo
  unificada de 2027 e o cálculo do Simples Nacional.
- `tests/compare-api.js` e `tests/compare-api-simples.js` comparam o motor do site com as duas APIs
  Java oficiais executadas localmente. Resultado na versão publicada:
  - regime regular: **18.238** combinações NCM/NBS × cClassTrib com o mesmo enquadramento e
    **6.572** cálculos de valor idênticos (centavo a centavo);
  - Simples Nacional: **400** cálculos idênticos.
- `tests/e2e.js` testa as três funcionalidades no navegador (Playwright), inclusive em celular.
- Crédito de estoque: `node tests/gerar-xmls-teste.js /tmp/xmls` gera NF-e de exemplo (revenda, ST,
  alíquota zero, Simples, imobilizado, transferência, devolução, cancelada, duplicada, importação,
  ISO-8859-1 e .zip); `tests/estoque.test.js` confere o motor e `tests/e2e-estoque.js` a aba no navegador.
- Nota pelo XML: `node tests/gerar-nfe-2026.js /tmp/nfe` gera NF-e de Lucro Presumido (notebook com IPI,
  arroz com redução de base do ICMS, medicamento com ST) e do Simples; `tests/nota-xml.test.js` confere o
  cálculo contra contas feitas à mão e `tests/e2e-nota-xml.js` a tela no navegador.
- Melhor regime: `node tests/gerar-sped-teste.js /tmp/sped` gera 12 meses de EFD ICMS/IPI e EFD Contribuições,
  ECD e balancete de uma empresa fictícia; `tests/regime.test.js` confere o motor contra contas feitas à mão e
  `tests/e2e-regime.js` a aba no navegador.
- Fornecedores: `tests/fornecedores.test.js <planilha.xlsx> [--rede]` (validação de CNPJ, leitura da lista,
  classificação, leitura do .xlsx da consulta de regime híbrido, fonte reserva e, com `--rede`, consulta real)
  e `tests/e2e-fornecedores.js` (aba no navegador, com respostas simuladas da BrasilAPI).

### Rodar localmente

```bash
python3 -m http.server 8765   # abra http://localhost:8765/
```

### Atualizar as tabelas quando a Receita publicar nova versão

```bash
git clone https://github.com/ReceitaFederal/calculadora-rtc-regime-regular
cd calculadora-rtc-regime-regular && mkdir -p calculadora/db
./mvnw flyway:migrate -Dflyway.configFiles=./flyway/flyway-pro.conf --batch-mode
cd -
python3 tools/export_data.py calculadora-rtc-regime-regular/calculadora/db/calculadora-pro.db 2027-03-10 data
```

## Limitações conhecidas

- **Simples Nacional:** a alíquota efetiva vem das tabelas da LC 123/2006; a parcela antes
  destinada a PIS/Cofins passa a CBS + IBS. A divisão entre CBS e IBS é uma **estimativa**
  (IBS ≈ parcela/91, arredondada), que reproduz as tabelas de 2027 divulgadas. Quando houver, use
  o pCBSSN/pIBSSN do PGDAS (campos opcionais).
- Fora do escopo: monofasia de combustíveis, regimes específicos (financeiro, planos de saúde,
  imóveis com alíquota fixa), suspensões/regimes aduaneiros e ajustes.
- A NFS-e de 2027 identifica o serviço pela **NBS**; a base oficial não traz correlação com CNAE.

## Aviso legal

Os valores são **aproximações** que dependem da veracidade e da exatidão das informações
fornecidas, das alíquotas efetivamente fixadas para 2027 e de regulamentação posterior. Não
substituem a apuração oficial nem a análise do caso concreto por profissional habilitado.

Regras e dados de origem: © Receita Federal do Brasil, licença MIT (ver `NOTICE-RECEITA-FEDERAL.txt`).
