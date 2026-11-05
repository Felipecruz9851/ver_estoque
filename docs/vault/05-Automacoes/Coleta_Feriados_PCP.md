---
script: "feriados.py"
tipo: "automacao"
linguagem: "python"
gatilho: "manual"
data_atualizacao: 2026-11-05
tags: [automacao, script, python, feriados, scraper, pcp]
---

# Automação: feriados.py

**Objetivo:** Script assíncrono para extração em lote dos feriados e recessos industriais cadastrados na Intranet do PCP (`/pcp/feriados.php`), gerando o arquivo local `backend/feriados.txt` utilizado no cálculo de dias úteis e retroação de lead time.

## Como é Executado (Gatilho)

- Executado manualmente via linha de comando (`python backend/feriados.py`) sempre que a equipe de PCP cadastrar ou alterar o calendário de feriados do ano fabril.

## Fluxo de Execução

1. Solicita credenciais corporativas do usuário via prompt de terminal com mascaramento de senha (`getpass`).
2. Autentica contra `/home/login/` estabelecendo cookie de sessão `PHPSESSID`.
3. Gera a grade de dias úteis (segunda a sexta-feira) para a faixa de anos configurada (ex: 2025, 2026, 2027).
4. Dispara requisições assíncronas concorrentes (controladas por semáforo `asyncio.Semaphore(15)`) para `/pcp/feriados.php?dat_ref=...`.
5. Filtra registros cujo código de situação indique feriado/recesso (`ies_situa == '3'`).
6. Ordena as datas únicas e grava a lista no arquivo texto `./backend/feriados.txt`.

## Arquivos Afetados

**➡️ Modifica/Lê:** `./backend/feriados.txt`, [[Calculo_Dias_Uteis_Feriados]]
