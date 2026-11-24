---
modulo: "service.py"
tipo: "backend"
linguagem: "python"
data_atualizacao: 2026-11-24
tags: [codigo, backend, python, service, orquestrador, regras-negocio]
---

# Módulo: service.py

**Responsabilidade:** Camada central de regras de negócio e serviços do Ver Estoque. Orquestra estados de sessão em memória, carga de snapshots, cálculo de atendimento cumulativo de estoque (modo Itens Finais MRP multinível ou modo Todas as OPs em 1 nível), enriquecimento gerencial de insumos com OPs e OCs, e consolidação de resumos por pedido e faltantes.

## Principais Funções / Métodos
* `gerar_dataframe_cons(recarregar, forcar_oc, sincronizar_snapshot)`: Carrega tabelas do snapshot (pedidos, saldos, estoque, ordens, estruturas), dispara sincronização remota e compõe a base unificada de consumo.
* `_construir_mapas_enriquecimento(df_dfs, df_consumo, forcar_oc)`: Indexa dados de ordens de produção (datas de abertura/entrega, `data_abertura_sort`, saldo da OP, fábrica) priorizando OPs no ano `2030`, identifica em `apoio_compras` itens com `OC > 0` para fallback em `/sup/vidrosoc.php` quando `forcar_oc=True`, e indexa OCs da Intranet (`/sup/oc_atrasadas-lgx.php`), preservando os caches `.pkl` locais em caso de falha.
* `obter_info_carregamento()` / `gerar_dataframe_cons()` / `obter_cons_com_cache()`: Exponibilizam `data_carga`, `data_carregamento`, `data_oc` e `snapshot`, além de disparar auto-sync das OCs quando um novo snapshot chega ou `scraper.cache_oc_expirado()` vence (30 min padrão).
* `_calcular_saldos_ops_abertura_d1(comp_item, data_corte_iso)`: Soma o saldo das OPs abertas do componente (`Tipo == 'P'`) segmentado pelo corte `hoje + 1` (`op_saldo_ate_d1` para abertura `<= hoje+1` ou ano `2030`, e `op_saldo_apos_d1` para abertura `> hoje+1`).
* `_normalizar_escopo_abatimento()` / `_extrair_filtros_escopo_abatimento()` / `_aplicar_filtro_escopo_filas()`: Implementam o modo `escopo_abatimento` (`"global"` vs `"filtrado"`), permitindo restringir a fila pré-MRP aos filtros ativos (local, pedido, código, datas, simulados e colunas pré-MRP) sem zerar o estoque físico inicial da linha.
* `_calcular_fila_todas_ops(df, b_norm, t_norm, fam_set, filtros_escopo)`: Executa o abatimento cumulativo FIFO vetorizado em 1 nível por OP (`Ordem Cons`), listando todas as OPs abertas (itens com e sem item pai, expondo `ordem_op`, `eh_raiz`, `item_final_pai`, `fabrica_pai`) sem dupla contagem de estoque, herdando `raiz_Entrega Pedido` em sub-OPs vinculadas a pedidos reais (`_ped_op_str != ""`) quando `Entrega Pedido` vier nulo e respeitando `filtros_escopo`.
* `_obter_fila_calculada(baixa_filtro, tipo_filtro, familias_filtro, ..., todas_ops, session_id, escopo_abatimento, filtros_escopo)`: Executa o abatimento cumulativo FIFO de estoque físico (Situação L), posicionando OPs com abertura em `2030` no topo da fila (`_prioridade_2030 = 0`), atualiza OCs automaticamente se `cache_oc_expirado()` for verdadeiro e aplica `escopo_abatimento="filtrado"` antes do loop MRP preservando `estoque_inicial` completo do `df`.
* `_filtrar_itens_finais_base(itens_full, filtros)`: Aplica filtros de local, pedido, código (incluindo `ordem_op`), simulados e janela de datas, incluindo sempre itens com `Data Abertura` em `2030` apenas ao filtrar por `Abertura da OP` (em `Entrega do pedido`, itens de abertura 2030 só entram se a entrega atender ao intervalo).
* `analisar_itens_finais(filtros, page, page_size, session_id, ...)`: Aplica paginação, `todas_ops` e `escopo_abatimento`, retornando também `data_oc`.
* `obter_resumo_faltantes(filtros, session_id, recarregar, forcar_oc)`: Consolida os insumos faltantes nas visões `por_insumo` (Produzidos P / Comprados C) e `por_item_pedido`, respeitando `todas_ops` e `escopo_abatimento`, além de suportar recarga forçada de snapshot/OC pelo botão `Atualizar`.
* `exportar_resumo_faltantes_excel(filtros, session_id)`: Gera `.xlsx` com abas `Produzidos (P)`/`Comprados (C)` ou `Por Local e Item-Pedido`.
* `_enriquecer_insumo_gerencial(...)` e `_organizar_insumos_gerencial(...)`: Enriquecem e agrupam insumos com datas/saldos de OPs (`Tipo == 'P'`) e OCs da Intranet para `Tipo in ('C', 'F')` (incluindo exibição conjunta com badges CST no frontend).
* `obter_detalhes_item_final(...)` / `obter_resumo_pedido(...)`: Aceitam `escopo_abatimento` e `filtros_escopo` para refletir o saldo exato da fila global ou filtrada nas telas secundárias.
* `obter_opcoes_filtros_faltantes(session_id)`: Retorna todas as fábricas de Itens Finais, fábricas de Componentes Produzidos (`Tipo == 'P'`) e prazos de expedição disponíveis para o menu de filtros.
* `obter_matriz_faltantes_producao(filtros, session_id)`: Calcula a Matriz Pivot de componentes produzidos faltantes agrupada por Local de Produção do Item Pai × Local de Produção do Componente × Prazo de Expedição (baseado no Representante via `settings.prazo_por_representante`), incluindo `op_saldo_ate_d1` e `op_saldo_apos_d1` por componente e invalidação de cache por data de corte (`hoje + 1`).
* `exportar_matriz_faltantes_excel(filtros, session_id)`: Exporta a Matriz Pivot de componentes produzidos faltantes para arquivo `.xlsx`, incluindo as colunas `Saldo da ops do item com abertura menor ou igual a hoje+1` e `Saldo das OPs com abertura maior que hoje+1`.
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
