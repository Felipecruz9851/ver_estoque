---
tipo: moc
---
# Index Ver_estoque

- **Backend** (`./backend/`):
  - `settings.py`: resolução de diretórios e variáveis de ambiente.
  - `snapshots.py`: leitura manual do snapshot mais recente (`.pkl` ou diretório `.parquet`).
  - `calculo.py`: consumo + resolução de Item Final em grafo BFS.
  - `scraper.py`: cliente autenticado `httpx` para consulta na Intranet (`http://192.168.0.6/home/login/`, saldos em `/pcp/situacao_pedidos2.php` e árvore em `/JSN001/json-pedido-estrutura.php`).
  - `feriados.py` / `feriados.txt`: coleta e calendário de feriados/recessos do PCP (`/pcp/feriados.php`) consumido no cálculo de dias úteis de abertura.
  - `service.py`: motor vetorizado de abatimento cumulativo de estoque (Situação L) ao longo da fila ordenada por Data de Abertura e gestão híbrida do Simulador de Pedidos (para pedidos já em carteira, preserva números/saldos originais e atualiza a Data de Abertura; para pedidos novos, importa saldo e estrutura da Intranet).
  - `main.py`: API FastAPI e servidor Uvicorn na porta 8687, executável via `python backend/main.py` ou `python -m backend`.
- **Frontend** (`./frontend/`): React/Vite/Tailwind (`./frontend/dist/` servido estaticamente pelo backend), tela `VerEstoque.jsx` com modal nativo `<dialog>` para simulação de múltiplos pedidos, destaque visual das linhas simuladas/destacadas, filtro exclusivo `Apenas Simulados` e detalhamento de saldo disponível na fila.
- **Dados** (`./backend/data/snapshots/`): pasta onde os snapshots (`.pkl` ou `.parquet`) são disponibilizados manualmente.
- Origem: módulo extraído do projeto Analise_compras em 2026-10-29. Ver [[2026-10-29]].
