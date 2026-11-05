---
script: "sincronizar_snapshots_remotos"
tipo: "automacao"
linguagem: "python"
gatilho: "evento"
data_atualizacao: 2026-11-05
tags: [automacao, script, python, sync, snapshots, rede, parquet]
---

# Automação: sincronizar_snapshots_remotos

**Objetivo:** Sincronizar de forma autônoma, atômica e granular os arquivos de tabelas `.parquet` das pastas de snapshot disponibilizadas pelo servidor remoto oficial de dados (`http://366n:8001/api/snapshots`), garantindo que o sistema de estoque opere com a base de ERP mais atualizada sem trafegar arquivos monolíticos `.pkl`.

## Como é Executado (Gatilho)

- Disparado automaticamente por evento durante a inicialização do backend (se `SNAPSHOTS_AUTO_SYNC=True`), sob demanda ao clicar no botão "Recarregar Dados" no frontend (`forcar=True`), ou via chamada direta ao endpoint POST `/api/snapshots/sync`.

## Fluxo de Execução

1. Realiza requisição `GET http://366n:8001/api/snapshots` identificando pastas de snapshot disponíveis (`snapshot_*`).
2. Para cada pasta, inspeciona e sincroniza exclusivamente as tabelas utilizadas (`ordens.parquet`, `cons.parquet`, `estoque.parquet` e `_sync_meta.json`).
3. Compara cabeçalhos HTTP `Content-Length` e `Last-Modified` com os arquivos locais.
4. Se houver divergência ou novos dados, efetua download atômico gravando em `_<tabela>.parquet.tmp`, validando a integridade do schema via Polars (`pl.read_parquet`) antes de substituir atomicamente e sincronizar timestamps (`os.utime`).
5. Suporte de rotas: testa padrão POSIX (`/`) com fallback automático para backslash URL-encoded (`%5C`) para total compatibilidade com rotas FastAPI sem o parâmetro `:path`.
6. Purga automaticamente quaisquer arquivos `.pkl` legados ou tabelas desnecessárias da pasta local de snapshots.
7. Tratamento de erro resiliente: se o servidor `366n` estiver temporariamente inacessível, a rotina não trava o sistema e prossegue com os snapshots Parquet locais existentes.

## Arquivos Afetados

**➡️ Modifica/Lê:** [[Gerenciador_Snapshots]], [[Snapshots_Parquet_Estoque]], [[Servico_Orquestrador_Service]]
