---
modulo: "snapshots.py"
tipo: "backend"
linguagem: "python"
data_atualizacao: 2026-11-05
tags: [codigo, backend, python, snapshots, parquet, sync]
---

# Módulo: snapshots.py

**Responsabilidade:** Gerenciador de ciclo de vida, localização, leitura e sincronização automática/sob demanda de snapshots de dados de estoque a partir de servidor remoto HTTP, com download streaming atômico e desempacotamento Parquet.

## Principais Funções / Métodos
* `sincronizar_snapshots_remotos(url, forcar, desempacotar, timeout_sec)`: Consulta catálogo remoto em `http://366n:8001/api/snapshots`, compara cabeçalhos (`Last-Modified`, `Content-Length`) e sincroniza atomicamente novos arquivos `.pkl`.
* `desempacotar_snapshot_parquet(pkl_path, output_dir)`: Converte as tabelas internas do snapshot Pickle (`.pkl`) em arquivos Parquet de alta performance com metadados `_sync_meta.json`.
* `listar_snapshots()`: Varre a pasta local de dados retornando snapshots disponíveis de forma deduplicada (priorizando parquet desempacotado).
* `localizar_snapshot(nome_ou_caminho)`: Resolve o diretório ou arquivo do snapshot desejado, com auto-sincronização de fallback se o repositório estiver vazio.
* `carregar_snapshot(nome_ou_caminho, tabelas)`: Efetua a carga seletiva das tabelas de negócio (`estoque`, `pedidos`, `estruturas`, etc.) em memória como DataFrames Polars.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[API_FastAPI_Main]]
* [[Servico_Orquestrador_Service]]
* [[Sincronizacao_Remota_Snapshots]]

**➡️ Quem este módulo chama (Saída/Uso):**
* [[Snapshots_Parquet_Estoque]]
* [[Configuracao_Settings]]
* **Bibliotecas Externas:** `polars`, `httpx`, `pickle`, `json`, `os`, `shutil`.
