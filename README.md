# Ver Estoque

Projeto autônomo que analisa a disponibilidade de itens finais contra o estoque (situação L), a partir de snapshots colocados manualmente.

## Uso
1. Cole o snapshot em `./backend/data/snapshots/` (`snapshot_*.pkl` ou pasta `snapshot_*/` com `.parquet`; precisa conter as tabelas `ordens`, `cons` e `estoque`). O mais recente é usado.
2. Instale as dependências: `pip install -r backend/requirements.txt`.
3. Compile o frontend (uma vez): `cd frontend && npm install && npm run build`.
4. Execute `iniciar.bat` (ou `python backend/main.py` / `cd backend && python main.py`) e abra http://localhost:8687/ver_estoque.

## API
`POST /ver_estoque/api/call/{método}` com `{"payload": {...}}`. Métodos: `obter_estoque_itens_finais`, `obter_detalhes_item_final`, `recarregar_dados_estoque`, `exportar_analise_estoque`. `GET /ver_estoque/api/snapshots` lista os snapshots disponíveis.

## Variáveis de ambiente
`VER_ESTOQUE_PORT` (8687), `VER_ESTOQUE_HOST`, `VER_ESTOQUE_SNAPSHOTS_DIR`, `VER_ESTOQUE_DATA_DIR`, `FRONTEND_DIST`.