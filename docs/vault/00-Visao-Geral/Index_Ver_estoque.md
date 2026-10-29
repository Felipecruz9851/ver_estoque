---
tipo: moc
---
# Index Ver_estoque

- **Backend** (`./backend/`): `settings.py` (resolução de diretórios e variáveis de ambiente), `snapshots.py` (leitura manual do snapshot), `calculo.py` (consumo + item final em grafo BFS), `service.py` (disponibilidade vs. estoque L), `main.py` (API FastAPI e servidor Uvicorn na porta 8687, executável via `python backend/main.py` ou `python -m backend`).
- **Frontend** (`./frontend/`): React/Vite/Tailwind (`./frontend/dist/` servido estaticamente pelo backend), tela `VerEstoque.jsx`.
- **Dados** (`./backend/data/snapshots/`): pasta onde os snapshots (`.pkl` ou `.parquet`) são disponibilizados manualmente.
- Origem: módulo extraído do projeto Analise_compras em 2026-10-29. Ver [[2026-10-29]].
