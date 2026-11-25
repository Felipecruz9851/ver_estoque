---
modulo: "main.py"
tipo: "backend"
linguagem: "python"
data_atualizacao: 2026-11-25
tags: [codigo, backend, python, fastapi, api, uvicorn]
---

# Módulo: main.py

**Responsabilidade:** Servidor HTTP FastAPI que expõe o roteamento RPC para o frontend, gerencia sessões de usuário via cookies `HttpOnly`, aplica compressão GZip, define políticas de `Cache-Control`, executa pré-aquecimento inicial em `lifespan`, provê endpoints REST para snapshots e serve arquivos estáticos do frontend e exportações.

## Principais Funções / Métodos
* `lifespan(_app)`: Gerenciador de ciclo de vida assíncrono do FastAPI que dispara em background a thread daemon `service.aquecer_cache_inicial()` no startup.
* `session_cookie_middleware(request, call_next)`: Middleware ASGI que intercepta requisições HTTP, resolve ou cria o cookie `ver_estoque_session` (`httponly=True`, `samesite="lax"`) com TTL configurado e anexa à resposta.
* `cache_control_middleware(request, call_next)`: Define `Cache-Control: public, max-age=31536000, immutable` para `/assets/*` (status 200) e `Cache-Control: no-cache` para `/` e `/ver_estoque`.
* `GZipMiddleware`: Compressão HTTP automática (`minimum_size=1000`, `compresslevel=5`) para payloads JSON e assets.
* `_resolver_session_id(request, response)`: Extrai o identificador de sessão válido a partir do cookie ou header `x-session-id`, gerando fallback `httponly=True`.
* `_executar(method, payload, session_id)`: Despachante interno de métodos RPC (`obter_estoque_itens_finais`, `obter_detalhes_item_final`, `obter_resumo_pedido`, `obter_matriz_faltantes_producao` com `slim=True`, `simular_pedidos`, etc.) para o serviço de domínio.
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
