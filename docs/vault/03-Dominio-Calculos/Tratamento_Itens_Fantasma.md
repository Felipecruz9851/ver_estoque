---
modulo: "Tratamento_Itens_Fantasma"
tipo: "dominio"
data_atualizacao: 2026-11-05
tags: [regras-negocio, calculo, parametros, fantasmas, engenharia, estrutura]
---

# Regra: Tratamento_Itens_Fantasma

**Contexto:** Na engenharia industrial do PCP, certos códigos são nós virtuais / fantasmas (indicados por `Tipo = 'T'` ou `ies_tip_item = 'T'`, como acabamentos `2ACAB*`, quantificadores `1M2*` ou agrupadores de mão de obra `1MAO*`). Esses itens não existem fisicamente em estoque e não devem ser requisitados na fila; no entanto, seus componentes filhos reais devem ser produzidos ou comprados.

## Lógica e Parâmetros

- **Variáveis de Entrada Obrigatórias:**
  - `estrutura_nos`: Lista de nós da árvore contendo `cod_item`, `cod_item_pai`, `tipo_item`, `ies_tip_item`, `baixa`, `quant_liquida`.
- **Condicionais Críticas:**
  - Se `tipo_item == 'T'` ou `ies_tip_item == 'T'`:
    - O nó fantasma é removido da listagem de insumos a baixar.
    - Se o nó fantasma possuir nós filhos:
      - O `cod_item_pai` de cada filho é reatribuído para o pai do nó fantasma.
      - A quantidade do filho é multiplicada pela quantidade do nó fantasma.
      - O nível hierárquico do filho é decrementado em 1 unidade.
  - Se o nó fantasma for folha (sem filhos):
    - O nó é simplesmente expurgado da árvore sem deixar resíduos.
- **Saída Esperada:**
  - Árvore de estrutura limpa, contendo apenas nós físicos de compra (`Tipo == 'C'`) ou produção real (`Tipo == 'P'`).

## Dependências

**⬅️ Consumido por:** [[Servico_Orquestrador_Service]]
