---
tipo: moc
---
# Index Ver_estoque

- **Backend** (`./backend/`):
  - `settings.py`: resolução de diretórios, variáveis de ambiente, parâmetros de sessão/cookies (`SESSION_COOKIE_NAME`, `SESSION_COOKIE_MAX_AGE`, `SESSION_TTL_SECONDS`) e endereço remoto oficial de snapshots (`SNAPSHOTS_REMOTE_URL = http://366n:8001/api/snapshots` com `SNAPSHOTS_AUTO_SYNC`).
  - `snapshots.py`: leitura e sincronização automática/sob demanda de snapshots a partir do servidor remoto (`http://366n:8001/api/snapshots`), com download atômico, verificação de integridade/timestamps (`Last-Modified`, `Content-Length`), preservação de mtime e desempacotamento para diretórios parquet com metadados `_sync_meta.json`.
  - `calculo.py`: consumo + resolução de Item Final em grafo BFS.
  - `scraper.py`: cliente autenticado `httpx` para consulta na Intranet (`http://192.168.0.6/home/login/`, saldos em `/pcp/situacao_pedidos2.php`, árvore em `/JSN001/json-pedido-estrutura.php` e ordens de compra de matérias-primas em `/sup/oc_atrasadas.php` combinando `sit_oc=S` [situação A] e padrão [situação P], com cache local em `./backend/data/oc_abertas_cache.pkl` e extração de vínculo por pedido/item no campo `Texto`).
  - `feriados.py` / `feriados.txt`: coleta e calendário de feriados/recessos do PCP (`/pcp/feriados.php`) consumido no cálculo de dias úteis de abertura.
  - `service.py`: motor vetorizado de abatimento cumulativo de estoque (Situação L) na fila com isolamento completo de sessão em memória (`SessionState`), enriquecimento gerencial de insumos (datas de abertura/entrega de OPs de componentes `Tipo == 'P'`, previsão mais antiga e vínculo por pedido nas OCs de matérias-primas `Tipo == 'C'`, saldo total de estoque, separação por tipo e agrupamento de componentes por fábrica), sincronização de snapshots remotos e consolidação por pedido (`obter_resumo_pedido`).
  - `main.py`: API FastAPI e servidor Uvicorn na porta 8687 com middleware HTTP para emissão/validação de cookies de sessão (`ver_estoque_session`), suporte a fallback via header `x-session-id`, endpoints RPC (`obter_estoque_itens_finais`, `obter_detalhes_item_final`, `obter_resumo_pedido`, `simular_pedidos_estoque`, `recarregar_dados_estoque`, `sincronizar_snapshots`, `exportar_ver_estoque_excel`), rotas REST `/api/snapshots` e `/api/snapshots/sync` e rotas estáticas para o frontend e exportações.
- **Frontend** (`./frontend/`): React/Vite/Tailwind (`./frontend/dist/` servido estaticamente pelo backend), tela `VerEstoque.jsx` mantendo a listagem principal intacta, sincronização automática de snapshots remotos no botão Recarregar Dados, tooltip e badge com nome do snapshot utilizado, detalhamento de insumos com visão gerencial (MP vs Componentes por Fábrica) e o modal nativo `<dialog>` **Resumo Gerencial do Pedido** ("O que falta para resolver o pedido ou o item").
- **Dados** (`./backend/data/snapshots/`): pasta de snapshots (`.pkl` e `.parquet`) consumidos automaticamente de `http://366n:8001/api/snapshots`, além de `./backend/data/oc_abertas_cache.pkl` para cache das OCs abertas da Intranet.
- Origem: módulo extraído do projeto Analise_compras em 2026-10-29. Ver [[2026-10-29]], [[2026-10-30]] e [[2026-11-04]].

## Tratamento de Itens Fantasma Implementado

- **[x] Tratamento de Itens Fantasma (`Tipo = 'T'` / `ies_tip_item`) no Simulador de Pedidos:**
  - **Regra:** Quando o JSON da estrutura de pedidos retorna `ies_tip_item = 'T'` (item fantasma / virtual, ex.: acabamentos `2ACAB*`, quantificadores `1M2*`, raízes de mão de obra `1MAO*` ou agrupadores), o item é removido da estrutura. Se o fantasma possuir componentes filhos na árvore, eles sobem para o nível do pai do fantasma (seu `cod_item_pai` passa a ser o pai do nó fantasma e o nível hierárquico é ajustado).
  - **Implementação:** Desenvolvida função `tratar_estrutura_fantasmas()` em `./backend/service.py`, integrada em `simular_pedidos()` e `_montar_df_pedido_simulado()`. Adicionada leitura direta de `ies_tip_item` e `baixa` retornados pela Intranet.
  - **Validação:** Coberta por suíte de testes unitários automatizados cobrindo fantasmas folhas, intermediários, aninhados e em subconjuntos com 100% de sucesso. Detalhes em [[2026-10-30]].
