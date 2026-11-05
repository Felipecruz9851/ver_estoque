---
modulo: "Snapshots_Parquet_Estoque"
tipo: "infra"
linguagem: "python"
data_atualizacao: 2026-11-05
tags: [codigo, infra, dados, parquet, snapshots, polars]
---

# Módulo: Snapshots_Parquet_Estoque

**Responsabilidade:** Infraestrutura de armazenamento e leitura colunar dos snapshots diários do ERP em `./backend/data/snapshots/`. Armazena arquivos `.pkl` originais e pastas desempacotadas contendo tabelas `.parquet` com arquivo de controle `_sync_meta.json`.

## Principais Funções / Métodos
* `desempacotar_snapshot_parquet(pkl_path, output_dir)`: Converte o dicionário de DataFrames serializado em Pickle para arquivos Parquet individuais (`estoque.parquet`, `pedidos.parquet`, `ordens.parquet`, etc.).
* `carregar_snapshot(caminho, tabelas)`: Efetua scan lazy/eager ultra-rápido com biblioteca Polars a partir dos arquivos `.parquet`.
* `_sync_meta.json`: Mantém integridade de hash, tamanho original e data de sincronização com o servidor remoto.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[Gerenciador_Snapshots]]
* [[Servico_Orquestrador_Service]]

**➡️ Quem este módulo chama (Saída/Uso):**
* Diretório local de dados `./backend/data/snapshots/`
* **Bibliotecas Externas:** `polars`, `pyarrow`, `pickle`.
