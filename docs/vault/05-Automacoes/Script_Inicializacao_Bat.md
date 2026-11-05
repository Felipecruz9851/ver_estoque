---
script: "iniciar.bat"
tipo: "automacao"
linguagem: "bat"
gatilho: "manual"
data_atualizacao: 2026-11-05
tags: [automacao, script, windows, bat, inicializacao]
---

# Automação: iniciar.bat

**Objetivo:** Iniciar o servidor backend do Ver Estoque de forma simplificada em ambiente Windows, localizando automaticamente o interpretador Python em ambientes virtuais padrão antes de recorrer ao binário global.

## Como é Executado (Gatilho)

- Executado manualmente pelo operador através de duplo clique no arquivo `iniciar.bat` na raiz do projeto ou invocado via terminal Windows / atalho de desktop.

## Fluxo de Execução

1. Navega até o diretório `./backend/` usando `%~dp0backend`.
2. Verifica se existe o ambiente virtual local em `./.venv/Scripts/python.exe`.
3. Se não existir, verifica o ambiente compartilhado corporativo em `C:\AMBIENTES\COMPRAS\.venv\Scripts\python.exe`.
4. Se nenhum ambiente virtual for encontrado, recorre ao `python` padrão registrado no `PATH` do Windows.
5. Inicia o processo `main.py`, que dispara o servidor ASGI Uvicorn na porta 8687.

## Arquivos Afetados

**➡️ Modifica/Lê:** [[API_FastAPI_Main]]
