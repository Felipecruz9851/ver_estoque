---
tipo: moc
---
# Index Ver_estoque

- **Backend** (`./backend/`):
  - `settings.py`: resolução de diretórios, variáveis de ambiente e parâmetros de sessão/cookies (`SESSION_COOKIE_NAME`, `SESSION_COOKIE_MAX_AGE`, `SESSION_TTL_SECONDS`).
  - `snapshots.py`: leitura manual do snapshot mais recente (`.pkl` ou diretório `.parquet`).
  - `calculo.py`: consumo + resolução de Item Final em grafo BFS.
  - `scraper.py`: cliente autenticado `httpx` para consulta na Intranet (`http://192.168.0.6/home/login/`, saldos em `/pcp/situacao_pedidos2.php` e árvore em `/JSN001/json-pedido-estrutura.php`).
  - `feriados.py` / `feriados.txt`: coleta e calendário de feriados/recessos do PCP (`/pcp/feriados.php`) consumido no cálculo de dias úteis de abertura.
  - `service.py`: motor vetorizado de abatimento cumulativo de estoque (Situação L) na fila com isolamento completo de sessão em memória (`SessionState`), garantindo concorrência segura (`threading.Lock`), expiração automática de sessões inativas e independência entre múltiplos usuários simultâneos no simulador e na exportação Excel.
  - `main.py`: API FastAPI e servidor Uvicorn na porta 8687 com middleware HTTP para emissão/validação de cookies de sessão (`ver_estoque_session`), suporte a fallback via header `x-session-id`, e rotas estáticas para o frontend e exportações.
- **Frontend** (`./frontend/`): React/Vite/Tailwind (`./frontend/dist/` servido estaticamente pelo backend), tela `VerEstoque.jsx` com modal nativo `<dialog>` para simulação de múltiplos pedidos, destaque visual das linhas simuladas/destacadas, filtro exclusivo `Apenas Simulados`, detalhamento de saldo disponível na fila e badge indicador de `Sessão Isolada` com identificador individual. Requests autenticados via `credentials: 'same-origin'` em `api.js`.
- **Dados** (`./backend/data/snapshots/`): pasta onde os snapshots (`.pkl` ou `.parquet`) são disponibilizados manualmente.
- Origem: módulo extraído do projeto Analise_compras em 2026-10-29. Ver [[2026-10-29]].

## Tratamento de Itens Fantasma Implementado

- **[x] Tratamento de Itens Fantasma (`Tipo = 'T'` / `ies_tip_item`) no Simulador de Pedidos:**
  - **Regra:** Quando o JSON da estrutura de pedidos retorna `ies_tip_item = 'T'` (item fantasma / virtual, ex.: acabamentos `2ACAB*`, quantificadores `1M2*`, raízes de mão de obra `1MAO*` ou agrupadores), o item é removido da estrutura. Se o fantasma possuir componentes filhos na árvore, eles sobem para o nível do pai do fantasma (seu `cod_item_pai` passa a ser o pai do nó fantasma e o nível hierárquico é ajustado).
  - **Implementação:** Desenvolvida função `tratar_estrutura_fantasmas()` em `./backend/service.py`, integrada em `simular_pedidos()` e `_montar_df_pedido_simulado()`. Adicionada leitura direta de `ies_tip_item` e `baixa` retornados pela Intranet.
  - **Validação:** Coberta por suíte de testes unitários automatizados cobrindo fantasmas folhas, intermediários, aninhados e em subconjuntos com 100% de sucesso. Detalhes em [[2026-10-30]].
