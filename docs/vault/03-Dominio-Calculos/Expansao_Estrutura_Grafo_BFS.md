---
modulo: "Expansao_Estrutura_Grafo_BFS"
tipo: "dominio"
data_atualizacao: 2026-11-05
tags: [regras-negocio, calculo, parametros, bfs, grafo, estrutura]
---

# Regra: Expansao_Estrutura_Grafo_BFS

**Contexto:** Algoritmo de busca em largura (BFS - Breadth-First Search) implementado em `backend/calculo.py` para percorrer a árvore de engenharia multinível de um item final e extrair a relação completa de insumos, matérias-primas e componentes semiacabados com seus respectivos consumos unitários acumulados.

## Lógica e Parâmetros

- **Variáveis de Entrada Obrigatórias:**
  - `df_estrutura`: DataFrame Polars/Pandas contendo colunas `cod_item_pai`, `cod_item_filho`, `quant_liquida`, `fator_refugo`, `tipo_filho`.
  - `itens_iniciais`: Lista de nós raiz (itens finais requisitados pelos pedidos).
- **Condicionais Críticas:**
  - **Prevenção de Ciclos:** Mantém conjunto `visitados` para evitar recursões infinitas em estruturas mal formadas no ERP.
  - **Multiplicação de Fatores:** O consumo no nó filho é o produto cumulativo das quantidades líquidas de todos os ancestrais na cadeia hierárquica.
  - **Tratamento de Fantasmas:** Itens transitórios de montagem têm seus filhos promovidos antes ou durante a expansão (ver [[Tratamento_Itens_Fantasma]]).
- **Saída Esperada:**
  - DataFrame tabular consolidado com `item_final`, `cod_item_insumo`, `consumo_unitario_total`, `tipo_insumo` e `nivel_hierarquico`.

## Dependências

**⬅️ Consumido por:** [[Servico_Orquestrador_Service]]
