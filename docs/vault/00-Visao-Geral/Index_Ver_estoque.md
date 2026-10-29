---
tipo: moc
---
# Index Ver_estoque

- **Backend** (`./backend/ver_estoque/`): `settings.py`, `snapshots.py` (leitura manual do snapshot), `calculo.py` (consumo + item final em grafo BFS), `service.py` (disponibilidade vs. estoque L), `api.py` (FastAPI, porta 8687).
- **Frontend** (`./frontend/`): React/Vite/Tailwind, tela `VerEstoque.jsx`.
- **Dados** (`./backend/data/snapshots/`): pasta onde os snapshots são colados.
- Origem: módulo extraído do projeto Analise_compras em 2026-10-29. Ver [[2026-10-29]].