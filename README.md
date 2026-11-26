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
   isento/imune/exportação), com o faturamento bruto somado automaticamente, deduções (descontos,
   ICMS, ISS — rateadas entre as faixas) e compras com crédito. No Simples padrão, seguindo a
   calculadora oficial, as reduções não alteram o DAS; só a faixa isenta/exportação fica fora. Mostra a receita líquida (base), débitos, créditos, CBS e IBS a recolher, carga efetiva
   e comparativo com o PIS/Cofins de 2026.
2. **Painel do contador** — vários clientes de uma vez (digitação ou importação de CSV),
   recálculo instantâneo, totais da carteira, exportação do resultado em CSV e impressão/PDF.
   Os dados ficam somente no navegador (localStorage).
3. **Simulador de nota fiscal** — valor da nota, NCM (NF-e) ou NBS (NFS-e) com busca por código,
   descrição ou item da LC 116. O enquadramento é **automático**: o site identifica, pelas tabelas
   oficiais (anexos da LC 214/2025 e correlação NBS × cClassTrib), se o código tem redução de 100%,
   60%, 40%, 30% etc. e já calcula a CBS, o IBS estadual e o IBS municipal com essa redução.
   Benefícios que dependem de condição do comprador (ex.: venda a órgão público) não são aplicados
   sozinhos, mas ficam listados para seleção.

Campos numéricos aceitam qualquer formato: 2000, 2.000, 2.000,00, 2000,5 ou 1,234.56.

4. **Crédito de estoque** — crédito presumido de CBS sobre o estoque de abertura de 2027 (art. 381 da
   LC 214/2025). A pessoa envia os XMLs das notas de compra (arquivos, pasta inteira ou .zip, sem
   limite; lidos no próprio navegador). O site separa o que gera crédito (revenda/insumo, ST e
   monofásico, importação) do que não gera (alíquota zero/isenção/suspensão, uso e consumo,
   imobilizado, transferência, devolução, remessa, notas canceladas e duplicadas), calcula 9,25% sobre o
   custo de aquisição do estoque, permite ajustar o inventário de 31/12/2026 (item a item, por % ou
   importando CSV) e monta o cronograma das 12 parcelas a partir do mês de apropriação (até junho/2027).

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
