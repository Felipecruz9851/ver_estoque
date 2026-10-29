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

## Pendências Técnicas Mapeadas

- **[ ] Tratamento de Itens Fantasma (`Tipo = 'F'`) no Simulador de Pedidos:**
  - **Problema:** Na tabela `cons` das OPs reais do snapshot, o ERP já explode os itens fantasma nos componentes filhos e não gera reserva para o fantasma. Já o endpoint `/JSN001/json-pedido-estrutura.php` retorna toda a árvore explodida sem informar o tipo mestre do item (`ies_tip_item`: `C`, `P`, `F`, `T`), fazendo com que itens fantasma/virtuais em pedidos novos simulados (ex.: acabamentos `2ACAB*`, quantificadores `1M2*`, raízes `1MAO*` e agrupadores `F`) entrem pelo fallback como `Produzido (P)` com estoque `0` e acusem falsa falta.
  - **Solução mapeada:** Incluir a coluna de tipo do item (`ies_tip_item` e, opcionalmente, flag de `baixa`) diretamente no `SELECT` de `json-pedido-estrutura.php` na Intranet, ou disponibilizar uma tabela leve de cadastro mestre de itens no snapshot para filtragem exata em `./backend/service.py`. Detalhes em [[2026-10-29]].
