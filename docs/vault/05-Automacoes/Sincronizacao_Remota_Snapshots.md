---
script: "sincronizar_snapshots_remotos"
tipo: "automacao"
linguagem: "python"
gatilho: "evento"
data_atualizacao: 2026-11-05
tags: [automacao, script, python, sync, snapshots, rede]
---

# Automação: sincronizar_snapshots_remotos

**Objetivo:** Sincronizar de forma autônoma e atômica os arquivos de snapshot (`.pkl` e `.parquet`) disponibilizados pelo servidor remoto oficial de dados (`http://366n:8001/api/snapshots`), garantindo que o sistema de estoque opere sempre com a base de ERP mais atualizada sem exigir intervenção manual.

## Como é Executado (Gatilho)

- Disparado automaticamente por evento durante a inicialização do backend (se `SNAPSHOTS_AUTO_SYNC=True`), sob demanda ao clicar no botão "Recarregar Dados" no frontend (`forcar=True`), ou via chamada direta ao endpoint POST `/api/snapshots/sync`.

## Fluxo de Execução

1. Realiza requisição `GET http://366n:8001/api/snapshots` obtendo a lista de arquivos remotos disponíveis.
2. Filtra arquivos `.pkl` válidos e inspeciona cabeçalhos HTTP `Content-Length` e `Last-Modified`.
3. Compara metadados com os arquivos já presentes em `./backend/data/snapshots/`.
4. Se houver novidades ou divergências, efetua download streaming com gravação em arquivo temporário `.tmp` e substituição atômica (`os.replace`), preservando o carimbo de data original (`os.utime`).
5. Dispara o desempacotamento automático para tabelas colunares `.parquet` acompanhado do arquivo de controle `_sync_meta.json`.
6. Tratamento de erro: se o servidor `366n` estiver offline ou com timeout de rede, a rotina não bloqueia o sistema, registrando um aviso informativo e prosseguindo com a base local já existente.

## Arquivos Afetados

**➡️ Modifica/Lê:** [[Gerenciador_Snapshots]], [[Snapshots_Parquet_Estoque]], [[Servico_Orquestrador_Service]]
