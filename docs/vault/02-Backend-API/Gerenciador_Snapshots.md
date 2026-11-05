---
modulo: "snapshots.py"
tipo: "backend"
linguagem: "python"
data_atualizacao: 2026-11-05
tags: [codigo, backend, python, snapshots, parquet, sync]
---

# Módulo: snapshots.py

**Responsabilidade:** Gerenciador de ciclo de vida, localização, leitura e sincronização automática/sob demanda de snapshots de dados de estoque a partir de servidor remoto HTTP (`366n:8001`), consumindo de forma 100% nativa e granular arquivos `.parquet` particionados (`ordens.parquet`, `cons.parquet`, `estoque.parquet` e `_sync_meta.json`). O formato legado `.pkl` foi totalmente descontinuado.

## Principais Funções / Métodos
* `sincronizar_snapshots_remotos(url, forcar, timeout_sec, limpar_desnecessarios)`: Consulta catálogo remoto em `http://366n:8001/api/snapshots`, identifica pastas de snapshots disponíveis e sincroniza exclusivamente os arquivos Parquet essenciais de forma atômica com validação de cache (`Last-Modified`, `Content-Length`) e escrita temporária `_<arquivo>.tmp`.
* `limpar_arquivos_desnecessarios(snapshot_dir)`: Pura arquivos `.pkl` legados e tabelas Parquet não consumidas no cálculo, mantendo apenas `ordens`, `cons`, `estoque` e `_sync_meta.json`.
* `listar_snapshots()`: Varre a pasta local de dados retornando apenas pastas Parquet íntegras contendo todas as tabelas essenciais, ordenadas por data de modificação.
* `localizar_snapshot(nome)`: Resolve o diretório do snapshot ativo com auto-sincronização de fallback.
* `carregar_snapshot(path)`: Efetua a carga das tabelas necessárias diretamente via Polars colunar para Pandas.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[API_FastAPI_Main]]
* [[Servico_Orquestrador_Service]]
* [[Sincronizacao_Remota_Snapshots]]

**➡️ Quem este módulo chama (Saída/Uso):**
* [[Snapshots_Parquet_Estoque]]
* [[Configuracao_Settings]]
* **Bibliotecas Externas:** `polars`, `pandas`, `json`, `os`, `shutil`, `urllib`.
