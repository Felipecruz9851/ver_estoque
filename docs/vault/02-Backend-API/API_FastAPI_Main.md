---
modulo: "main.py"
tipo: "backend"
linguagem: "python"
data_atualizacao: 2026-11-05
tags: [codigo, backend, python, fastapi, api, uvicorn]
---

# Módulo: main.py

**Responsabilidade:** Servidor HTTP FastAPI que expõe o roteamento RPC para o frontend, gerencia sessões de usuário via cookies/headers, provê endpoints REST para snapshots e serve arquivos estáticos do frontend e exportações.

## Principais Funções / Métodos
* `session_cookie_middleware(request, call_next)`: Middleware ASGI que intercepta requisições HTTP, resolve ou cria o cookie `ver_estoque_session` com TTL configurado e anexa à resposta.
* `_resolver_session_id(request, response)`: Extrai o identificador de sessão válido a partir do cookie ou header `x-session-id`, gerando fallback limpo.
* `_executar(method, payload, session_id)`: Despachante interno de métodos RPC (`obter_estoque_itens_finais`, `obter_detalhes_item_final`, `obter_resumo_pedido`, `simular_pedidos`, etc.) para o serviço de domínio.
* `call_method(method, req, request, response)`: Endpoint POST `/ver_estoque/api/call/{method}` que recebe payloads JSON e executa as regras em isolamento de sessão.
* `snapshots()` / `sync_snapshots(forcar)`: Endpoints REST `/api/snapshots` para consulta e sincronização manual sob demanda da base remota.
* `main()`: Ponto de entrada CLI para subida do servidor ASGI Uvicorn na porta e host definidos nas configurações.

## Dependências (Grafo)
**⬅️ Quem chama este módulo (Entrada):**
* [[Script_Inicializacao_Bat]]
* [[API_Client_Frontend]]
* Navegador Web (HTTP/REST)

**➡️ Quem este módulo chama (Saída/Uso):**
* [[Servico_Orquestrador_Service]]
* [[Gerenciador_Snapshots]]
* [[Configuracao_Settings]]
* **Bibliotecas Externas:** `fastapi`, `uvicorn`, `pydantic`.
