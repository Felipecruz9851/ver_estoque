---
modulo: "Snapshots_Parquet_Estoque"
tipo: "infra"
linguagem: "python"
data_atualizacao: 2026-11-05
tags: [codigo, infra, dados, parquet, snapshots, polars]
---

# Módulo: Snapshots_Parquet_Estoque

**Responsabilidade:** Infraestrutura de armazenamento e leitura colunar dos snapshots diários do ERP em `./backend/data/snapshots/`. Armazena exclusivamente pastas estruturadas contendo as tabelas essenciais (`ordens.parquet`, `cons.parquet`, `estoque.parquet`) e arquivo de controle de versão `_sync_meta.json`. O formato monolítico Pickle (`.pkl`) foi descontinuado.

## Principais Funções / Métodos
* `carregar_snapshot(path)`: Efetua leitura direta ultra-rápida e vetorizada via Polars (`pl.read_parquet`) convertendo para Pandas apenas na borda do cálculo.
* `limpar_arquivos_desnecessarios(snapshot_dir)`: Remove arquivos `.pkl` legados e tabelas Parquet não consumidas pelo motor de cálculo do `Ver_estoque`, reduzindo o consumo de disco em mais de 98%.
* `_sync_meta.json`: Mantém integridade de hash, tamanho original e data de sincronização com o servidor remoto.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[Gerenciador_Snapshots]]
* [[Servico_Orquestrador_Service]]

**➡️ Quem este módulo chama (Saída/Uso):**
* Diretório local de dados `./backend/data/snapshots/`
* **Bibliotecas Externas:** `polars`, `pyarrow`.
