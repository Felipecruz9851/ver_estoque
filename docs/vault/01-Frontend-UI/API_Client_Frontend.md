---
modulo: "api.js"
tipo: "frontend"
linguagem: "javascript"
data_atualizacao: 2026-11-25
tags: [codigo, frontend, javascript, fetch, http]
---

# Módulo: api.js

**Responsabilidade:** Camada de transporte HTTP do frontend responsável por envelopar chamadas RPC para o backend FastAPI, repassando credenciais de sessão, suporte a cancelamento via `AbortSignal` e tratamento de exceções de rede e negócio.

## Principais Funções / Métodos
* `apiCall(method, payload, { signal } = {})`: Envia requisição POST para `/ver_estoque/api/call/${method}` com `credentials: 'same-origin'` e `signal` opcional para cancelamento via `AbortController` (propagando `AbortError`), serializa o corpo em JSON e valida erros retornados.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[VerEstoque_Componente]]

**➡️ Quem este módulo chama (Saída/Uso):**
* [[API_FastAPI_Main]]
* **Bibliotecas Externas:** `Fetch API` nativa do navegador.
