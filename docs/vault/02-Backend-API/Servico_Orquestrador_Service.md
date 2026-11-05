---
modulo: "service.py"
tipo: "backend"
linguagem: "python"
data_atualizacao: 2026-11-05
tags: [codigo, backend, python, service, orquestrador, regras-negocio]
---

# Módulo: service.py

**Responsabilidade:** Camada central de regras de negócio e serviços do Ver Estoque. Orquestra estados de sessão em memória, carga de snapshots, cálculo de atendimento cumulativo de estoque, enriquecimento gerencial de insumos com OPs e OCs, e consolidação de resumos por pedido.

## Principais Funções / Métodos
* `gerar_dataframe_cons(recarregar, forcar_oc, sincronizar_snapshot)`: Carrega tabelas do snapshot (pedidos, saldos, estoque, ordens, estruturas), dispara sincronização remota e compõe a base unificada de consumo.
* `_construir_mapas_enriquecimento(ordens_df, oc_df)`: Indexa dados de ordens de produção (datas de abertura/entrega, fábrica) e ordens de compra de matérias-primas (vínculo por pedido/item ou previsão mais antiga).
* `_obter_fila_calculada(cons_efetivo, session_id, ...)`: Executa o abatimento cumulativo FIFO de estoque físico (Situação L), com tratamento de tolerância a arredondamentos.
* `analisar_itens_finais(filtros, page, page_size, session_id, ...)`: Aplica paginação e filtros sobre os itens finais calculados, computando o percentual de atendimento do pedido.
* `_enriquecer_insumo_gerencial(insumo_dict, mapas, ...)`: Enriquece itens filhos com datas de OPs de componentes (`Tipo == 'P'`) e previsão de OCs de matérias-primas (`Tipo == 'C'`).
* `obter_detalhes_item_final(...)`: Retorna insumos e componentes detalhados de um item final com divisão em Matéria-Prima e Componentes por Fábrica.
* `obter_resumo_pedido(...)`: Consolida a visão executiva de tudo o que falta para produzir um pedido ou item final específico.
* `simular_pedidos(...)`: Consulta estruturas e saldos via Intranet para injetar novos pedidos na fila cumulativa da sessão do usuário.
* `exportar_analise_excel(...)`: Gera arquivo `.xlsx` completo com formatação executiva na pasta de exportações.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[API_FastAPI_Main]]

**➡️ Quem este módulo chama (Saída/Uso):**
* [[Calculo_Fila_Atendimento_Estoque]]
* [[Expansao_Estrutura_Grafo_BFS]]
* [[Tratamento_Itens_Fantasma]]
* [[Calculo_Saldo_OC_Ate_Abertura]]
* [[Calculo_Dias_Uteis_Feriados]]
* [[Scraper_Intranet_PCP]]
* [[Gerenciador_Snapshots]]
* [[Gerenciamento_Sessao_Memoria]]
* [[Configuracao_Settings]]
* **Bibliotecas Externas:** `polars`, `pandas`, `openpyxl`, `numpy`.
